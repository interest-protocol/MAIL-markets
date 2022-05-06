//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import "./interfaces/AggregatorV3Interface.sol";
import "./interfaces/IMAILDeployer.sol";
import "./interfaces/ILibraryWrapper.sol";

import "./lib/IntMath.sol";
import "./lib/IntERC20.sol";

/**
 * @dev A wrapper around the Chainlink oracles to feed prices to the markets. It aims to house all oracle logic of the protocol.
 *
 * @notice Bridge token refers to the wrapped version of the native token as WETH on ETH.
 * @notice Security of this contract relies on Chainlink.
 * @notice We scale all decimals to 18 to follow the ERC20 standard decimals.
 * @notice It does not treat in case of a price of 0 or failure.
 * @notice Only supports tokens supported by Chainlink
 */
contract Oracle is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    /*///////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event NewFeed(address indexed token, AggregatorV3Interface indexed feed);

    /*///////////////////////////////////////////////////////////////
                            LIBRARIES
    //////////////////////////////////////////////////////////////*/
    using IntMath for uint256;
    using SafeCastUpgradeable for *;
    using IntERC20 for address;

    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    //solhint-disable-next-line var-name-mixedcase
    IUniswapV3Factory private constant UNISWAP_V3_FACTORY =
        IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    //solhint-disable-next-line var-name-mixedcase
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    //solhint-disable-next-line var-name-mixedcase
    ILibraryWrapper public LIBRARY_WRAPPER;

    // solhint-disable-next-line var-name-mixedcase
    IMAILDeployer public MAIL_DEPLOYER;

    // Token Address -> Chainlink feed with ETH base.
    mapping(address => AggregatorV3Interface) public getETHFeeds;

    /*///////////////////////////////////////////////////////////////
                            INITIALIZER
    //////////////////////////////////////////////////////////////*/

    /**
     * @param libraryWrapper Uniswap library to interact with the oracle
     *
     * Requirements:
     *
     * - Can only be called at once and should be called during creation to prevent front running.
     */
    function initialize(ILibraryWrapper libraryWrapper) external initializer {
        __Ownable_init();

        LIBRARY_WRAPPER = libraryWrapper;
    }

    /*///////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getRiskytokenPrice(address riskytoken, uint256 amount)
        external
        view
        returns (uint256)
    {
        // Save gas
        IUniswapV3Factory factory = UNISWAP_V3_FACTORY;
        IMAILDeployer mailDeployer = MAIL_DEPLOYER;
        ILibraryWrapper libraryWrapper = LIBRARY_WRAPPER;
        address weth = WETH;

        // Get total amount of fees supported by UniswapV3
        uint256 length = mailDeployer.getFeesLength();

        // Will save the tickMean for the pool with highest liquidity in last 24 hours
        uint128 liquidityMean;
        int24 tickMean;

        // Iterate to all UniswapV3 pools for `riskytoken` and the bridge token
        // If the pool exists for the fee and has a higher liquidity we update the `liquidityMean` and `tickMean`.
        for (uint256 i; i < length; i++) {
            uint24 fee = mailDeployer.fees(i);
            address pool = factory.getPool(weth, riskytoken, fee);
            if (pool == address(0)) continue;

            (int24 poolTickMean, uint128 poolLiquidityMean) = libraryWrapper
                .consult(pool, 24 hours);

            if (poolLiquidityMean > liquidityMean) {
                liquidityMean = poolLiquidityMean;
                tickMean = poolTickMean;
            }
        }

        // Get price in bridge token
        uint256 quoteAmount = libraryWrapper.getQuoteAtTick(
            tickMean,
            amount.toUint128(),
            riskytoken,
            weth
        );

        // scale the price to 18 decimals. Usually wrapped bridge tokens do have 18 decimals.
        return quoteAmount.toBase(weth.safeDecimals());
    }

    /**
     * @dev It calls chainlink to get the ETH price of a token and adjusts the decimals.
     *
     * @notice The amount will have 18 decimals
     *
     * @param token The address of the token for the feed.
     * @param amount The number of tokens to calculate the value in ETH.
     * @return uint256 The price of the token in ETH with 18 decimals.
     *
     * Requirements:
     *
     * - Token cannot be the zero address.
     */
    function getETHPrice(address token, uint256 amount)
        public
        view
        returns (uint256)
    {
        require(token != address(0), "Oracle: no address zero");

        if (token == WETH) return 1 ether;

        AggregatorV3Interface feed = getETHFeeds[token];

        (, int256 answer, , , ) = feed.latestRoundData();

        return answer.toUint256().toBase(feed.decimals()).bmul(amount);
    }

    /*///////////////////////////////////////////////////////////////
                            OWNER ONLY FUNCTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Sets a chain link {AggregatorV3Interface} feed for an token.
     *
     * @param token The token that will be associated with a feed.
     * @param feed The address of the chain link oracle contract.
     *
     * **** IMPORTANT ****
     * @notice This contract only supports tokens with 18 decimals.
     * @notice You can find the avaliable feeds here https://docs.chain.link/docs/binance-smart-chain-addresses/
     *
     * Requirements:
     *
     * - This function has the modifier {onlyOwner} because the whole protocol depends on the quality and veracity of these feeds. It will be behind a multisig and timelock as soon as possible.
     */
    function setFeed(address token, AggregatorV3Interface feed)
        external
        onlyOwner
    {
        getETHFeeds[token] = feed;
        emit NewFeed(token, feed);
    }

    /**
     *@dev The `MAIL_DEPLOYER` require the oracle and the oracle requires the mail deployer. So this is a helper function to first deploy the Mail Deployer and then update the oracle
     *
     * @param mailDeployer the address of the mail deployer
     *
     * Requirements:
     *
     * - It can only be called once and by the owner
     */
    function setMailDeployer(IMAILDeployer mailDeployer) external onlyOwner {
        require(
            address(MAIL_DEPLOYER) == address(0),
            "Oracle: can only be set once"
        );
        MAIL_DEPLOYER = mailDeployer;
    }

    /**
     * @dev A hook to guard the address that can update the implementation of this contract. It must be the owner.
     */
    function _authorizeUpgrade(address)
        internal
        view
        override
        onlyOwner
    //solhint-disable-next-line no-empty-blocks
    {

    }
}
