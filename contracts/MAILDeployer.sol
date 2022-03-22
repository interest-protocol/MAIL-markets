//SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import "./interfaces/IMAILDeployer.sol";

import "./MAIL.sol";

contract MAILDeployer is Ownable, IMAILDeployer {
    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    //solhint-disable-next-line var-name-mixedcase
    address private immutable UNISWAP_V3_FACTORY;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable BTC;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable BRIDGE_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable USDC;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable USDT;

    // Address to collect the reserve funds
    address public treasury;

    // % of interest rate to be collected by the treasury
    uint256 public reserveFactor;

    // Contract to calculate borrow and supply rate for the risky asset
    address public riskyAssetInterestRateModel;

    // Array containing all the current fees supported by Uniswap V3
    uint24[] public fees;

    // FEE -> BOOL A mapping to prevent duplicates to the `fees` array
    mapping(uint256 => bool) private _hasFee;

    // Risky Token => Market Contract
    mapping(address => address) public getMarket;

    // Token => Interest Rate Model (BTC/USDC/USDT/BRIDGE_TOKEN)
    mapping(address => address) public getInterestRateModel;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param uniswapV3Factory The address of Uniswap V3 Factory
     * @param btc The ERC20 address for BTC
     * @param bridgeToken The address of the Wrapped version of the native token for this network - e.g. Wrapped Ether
     * @param usdc The ERC20 address for USDC
     * @param usdt The ERC20 address for USDT
     * @param btcModel The address of the Interest Rate Model contract for BTC
     * @param usdcModel The address of the Interest Rate Model contract for USDC
     * @param bridgeTokenModel The address of the Interest Rate Model contract for the wrapped Native Token
     * @param usdtModel The address of the Interest Rate Model contract for USDT
     * @param riskyAssetModel The address of the Interest Rate Model contract for USDT
     * @param _treasury The address that will collect all protocol fees
     * @param _reserveFactor The % of the interest rate that will be sent to the treasury. It is a 18 mantissa number
     *
     * Requirements:
     *
     * - None of the tokens and interest rate models can be the zero address
     */
    constructor(
        address uniswapV3Factory,
        address btc,
        address bridgeToken,
        address usdc,
        address usdt,
        address btcModel,
        address usdcModel,
        address bridgeTokenModel,
        address usdtModel,
        address riskyAssetModel,
        address _treasury,
        uint256 _reserveFactor
    ) {
        // Protect agaisnt wrongly passing the zero address
        require(btcModel != address(0), "btc: no zero address");
        require(usdcModel != address(0), "usdc: no zero address");
        require(usdtModel != address(0), "usdt: no zero address");
        require(bridgeTokenModel != address(0), "bt: no zero address");
        require(riskyAssetModel != address(0), "ra: no zero address");
        require(uniswapV3Factory != address(0), "uni: no zero address");

        // Add current supported UniswapV3 fees
        fees.push(500);
        fees.push(3000);
        fees.push(10000);

        // Update the guard map
        _hasFee[500] = true;
        _hasFee[3000] = true;
        _hasFee[10000] = true;

        // Update Global state
        UNISWAP_V3_FACTORY = uniswapV3Factory;
        BTC = btc;
        BRIDGE_TOKEN = bridgeToken;
        USDC = usdc;
        USDT = usdt;
        treasury = _treasury;
        reserveFactor = _reserveFactor;

        // Map the token to the right interest rate model
        getInterestRateModel[address(btc)] = btcModel;
        getInterestRateModel[address(usdc)] = usdcModel;
        getInterestRateModel[address(usdt)] = usdtModel;
        getInterestRateModel[address(bridgeToken)] = bridgeTokenModel;

        riskyAssetInterestRateModel = riskyAssetModel;
    }

    /*///////////////////////////////////////////////////////////////
                        VIEW 
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Computes the address of a market address for the a `riskyAsset`.
     *
     * @param riskyAsset Market address for this asset will be returned
     * @return address The market address for the `riskyAsset`.
     */
    function predictMarketAddress(address riskyAsset)
        external
        view
        returns (address)
    {
        address deployer = address(this);
        bytes32 salt = keccak256(abi.encode(riskyAsset));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(MAIL).creationCode)
        );

        return
            address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                hex"ff",
                                deployer,
                                salt,
                                initCodeHash
                            )
                        )
                    )
                )
            );
    }

    /*///////////////////////////////////////////////////////////////
                        MUTATIVE FUNCTIONS  
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev It deploys a MAIL market for the `risky` asset
     *
     * @param riskyAsset Any ERC20 asset with a pool in UniswapV3
     * @return market the address of the new deployed market.
     *
     * Requirements:
     *
     * - Risky Asset cannot be BTC, BRIDGE_TOKEN, USDC, USDT or the zero address
     * - Risky asset must have a pool in UniswapV3
     * - There is no deployed market for this `risky asset`.
     */
    function deploy(address riskyAsset) external returns (address market) {
        // Make sure the `riskyAsset` is different than BTC, BRIDGE_TOKEN, USDC, USDT, zero address
        require(riskyAsset != BTC, "MD: cannot be BTC");
        require(riskyAsset != BRIDGE_TOKEN, "MD: cannot be BRIDGE_TOKEN");
        require(riskyAsset != USDC, "MD: cannot be USDC");
        require(riskyAsset != USDT, "MD: cannot be USDT");
        require(riskyAsset != address(0), "MD: no zero address");
        // Checks if a pool exists
        require(_doesPoolExist(riskyAsset), "MD: no pool for this asset");
        // Checks that no market has been deployed for the `riskyAsset`.
        require(
            getMarket[riskyAsset] == address(0),
            "MD: market already deployed"
        );

        // Deploy the market
        market = address(
            new MAIL{salt: keccak256(abi.encode(riskyAsset))}(
                BTC,
                BRIDGE_TOKEN,
                USDC,
                USDT,
                riskyAsset
            )
        );

        // Update global state
        getMarket[riskyAsset] = market;

        emit MarketCreated(market);
    }

    /*///////////////////////////////////////////////////////////////
                        PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Checks if UniswapV3 has a pool for `riskyAsset`
     *
     * @param riskyAsset Checks if UniswapV3 has a pool for this address and the `BRIDGE_TOKEN`
     * @return bool If there is a pool or not.
     */
    function _doesPoolExist(address riskyAsset) private view returns (bool) {
        // Save gas
        address bridgeToken = BRIDGE_TOKEN;
        IUniswapV3Factory uniswapV3Factory = IUniswapV3Factory(
            UNISWAP_V3_FACTORY
        );

        bool hasPool;

        // save gas
        uint24[] memory _fees = fees;

        // Loop through all the fees and check if there is a `riskyAsset` and `BRIDGE_TOKEN` pool for the fee
        for (uint256 i; i < _fees.length; i++) {
            address pool = uniswapV3Factory.getPool(
                bridgeToken,
                riskyAsset,
                _fees[i]
            );
            if (pool != address(0)) {
                hasPool = true;
                break;
            }
        }

        return hasPool;
    }

    /*///////////////////////////////////////////////////////////////
                        OWNER ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Adds a new fee supported by UniswapV3
     *
     * @param fee The new fee to add
     *
     * Requirements:
     *
     * - Fee must not be present in the array already
     */
    function addUniswapV3Fee(uint24 fee) external onlyOwner {
        require(!_hasFee[fee], "MD: already added");
        _hasFee[fee] = true;
        fees.push(fee);
        emit NewUniSwapFee(fee);
    }

    /**
     * @dev Updates the % of the interest rate that is sent to the treasury
     *
     * @param amount A number with 18 mantissa
     *
     * Requirements:
     *
     * - `amount` cannot be greater than 25%.
     * - Only the Int Governance can update this value.
     */
    function setReserveFactor(uint256 amount) external onlyOwner {
        require(amount <= 0.25 ether, "MD: no zero amount");
        reserveFactor = amount;
        emit SetReserveFactor(amount);
    }

    /**
     * @dev Updates the treasury address
     *
     * @param account The new treasury address
     */
    function setTreasury(address account) external onlyOwner {
        treasury = account;
        emit SetTreasury(account);
    }

    /**
     * @dev Updates the interest rate model for a `token`.
     *
     * @param token The token that will be assigned a new `interestRateModel`
     * @param interestRateModel The new interesr rate model for `token`
     *
     * Requirements:
     *
     * - Only the Int Governance can update this value.
     * - Interest rate model and token cannot be the address zero
     */
    function setInterestRateModel(address token, address interestRateModel)
        external
        onlyOwner
    {
        require(address(token) != address(0), "MD: no zero address");
        require(interestRateModel != address(0), "MD: no zero address");
        getInterestRateModel[token] = interestRateModel;
        emit SetInterestRateModel(token, interestRateModel);
    }

    /**
     * @dev This updates the interest rate model for the risky asset
     *
     * @param interestRateModel The interest rate model for the risky asset
     *
     * Requirements:
     *
     * - Only the Int Governance can update this value.
     * - Interest rate model and token cannot be the address zero
     */
    function setRiskyAssetInterestRateModel(address interestRateModel)
        external
        onlyOwner
    {
        require(interestRateModel != address(0), "MD: no zero address");
        riskyAssetInterestRateModel = interestRateModel;
        emit SetInterestRateModel(address(0), interestRateModel);
    }
}
