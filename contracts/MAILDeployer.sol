//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import "./interfaces/IMAILDeployer.sol";

import "./MAIL.sol";

contract MAILDeployer is Ownable, IMAILDeployer {
    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    uint256 private constant INITIAL_MAX_LTV = 0.5e18;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable UNISWAP_V3_FACTORY;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable BTC;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable BRIDGE_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable USDC;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable USDT;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable ORACLE;

    address public riskyToken;

    // Address to collect the reserve funds
    address public treasury;

    // % of interest rate to be collected by the treasury
    uint256 public reserveFactor;

    // Contract to calculate borrow and supply rate for the risky token
    address public riskyTokenInterestRateModel;

    uint256 public riskyTokenLTV;

    // Array containing all the current fees supported by Uniswap V3
    uint24[] public fees;

    // FEE -> BOOL A mapping to prevent duplicates to the `fees` array
    mapping(uint256 => bool) private _hasFee;

    // Risky Token => Market Contract
    mapping(address => address) public getMarket;

    // Token => Interest Rate Model (BTC/USDC/USDT/BRIDGE_TOKEN)
    mapping(address => address) public getInterestRateModel;

    // Token => LTV
    mapping(address => uint256) public maxLTVOf;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param uniswapV3Factory The address of Uniswap V3 Factory
     * @param btc The ERC20 address for BTC
     * @param wrappedNativeToken The address of the Wrapped version of the native token for this network - e.g. Wrapped Ether
     * @param usdc The ERC20 address for USDC
     * @param usdt The ERC20 address for
     * @param oracle The oracle used by MAIL lending markets
     * @param _treasury The address that will collect all protocol fees
     * @param _reserveFactor The % of the interest rate that will be sent to the treasury. It is a 18 mantissa number
     * @param modelData Data about the interest rate models for usdc, btc, wrappedNativeToken, usdt and risky token
     *
     * Requirements:
     *
     * - None of the tokens, interest rate models and oracle can be the zero address
     */
    constructor(
        address uniswapV3Factory,
        address btc,
        address wrappedNativeToken,
        address usdc,
        address usdt,
        address oracle,
        address _treasury,
        uint256 _reserveFactor,
        bytes memory modelData
    ) {
        (
            address btcModel,
            address usdcModel,
            address wrappedNativeTokenModel,
            address usdtModel,
            address riskytokenModel
        ) = abi.decode(
                modelData,
                (address, address, address, address, address)
            );

        // Protect agaisnt wrongly passing the zero address
        require(btcModel != address(0), "btc: no zero address");
        require(usdcModel != address(0), "usdc: no zero address");
        require(usdtModel != address(0), "usdt: no zero address");
        require(wrappedNativeTokenModel != address(0), "bt: no zero address");
        require(riskytokenModel != address(0), "ra: no zero address");
        require(uniswapV3Factory != address(0), "uni: no zero address");
        require(oracle != address(0), "oracle: no zero address");

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
        BRIDGE_TOKEN = wrappedNativeToken;
        USDC = usdc;
        USDT = usdt;
        ORACLE = oracle;
        treasury = _treasury;
        reserveFactor = _reserveFactor;

        // Map the token to the right interest rate model
        getInterestRateModel[btc] = btcModel;
        getInterestRateModel[usdc] = usdcModel;
        getInterestRateModel[usdt] = usdtModel;
        getInterestRateModel[wrappedNativeToken] = wrappedNativeTokenModel;
        riskyTokenInterestRateModel = riskytokenModel;

        // Set Initial LTV
        maxLTVOf[btc] = INITIAL_MAX_LTV;
        maxLTVOf[usdc] = INITIAL_MAX_LTV;
        maxLTVOf[usdt] = INITIAL_MAX_LTV;
        maxLTVOf[wrappedNativeToken] = INITIAL_MAX_LTV;
        riskyTokenLTV = INITIAL_MAX_LTV;
    }

    /*///////////////////////////////////////////////////////////////
                                    VIEW 
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Total amount of fees supported by UniswapV3
     * @return uint256 The number of fees
     */
    function getFeesLength() external view returns (uint256) {
        return fees.length;
    }

    /**
     * @dev Computes the address of a market address for the a `riskyToken`.
     *
     * @param _riskytoken Market address for this token will be returned
     * @return address The market address for the `riskytoken`.
     */
    function predictMarketAddress(address _riskytoken)
        external
        view
        returns (address)
    {
        address deployer = address(this);
        bytes32 salt = keccak256(abi.encode(_riskytoken));
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
     * @dev It deploys a MAIL market for the `risky` token
     *
     * @param _riskyToken Any ERC20 token with a pool in UniswapV3
     * @return market the address of the new deployed market.
     *
     * Requirements:
     *
     * - Risky token cannot be BTC, BRIDGE_TOKEN, USDC, USDT or the zero address
     * - Risky token must have a pool in UniswapV3
     * - There is no deployed market for this `_riskyToken`.
     */
    function deploy(address _riskyToken) external returns (address market) {
        // Make sure the `riskytoken` is different than BTC, BRIDGE_TOKEN, USDC, USDT, zero address
        require(_riskyToken != BTC, "MD: cannot be BTC");
        require(_riskyToken != BRIDGE_TOKEN, "MD: cannot be BRIDGE_TOKEN");
        require(_riskyToken != USDC, "MD: cannot be USDC");
        require(_riskyToken != USDT, "MD: cannot be USDT");
        require(_riskyToken != address(0), "MD: no zero address");
        // Checks if a pool exists
        require(_doesPoolExist(_riskyToken), "MD: no pool for this token");
        // Checks that no market has been deployed for the `riskyToken`.
        require(
            getMarket[_riskyToken] == address(0),
            "MD: market already deployed"
        );
        riskyToken = _riskyToken;

        // Deploy the market
        market = address(
            new MAIL{salt: keccak256(abi.encodePacked(_riskyToken))}()
        );

        riskyToken = address(0);
        // Update global state
        getMarket[_riskyToken] = market;

        emit MarketCreated(market);
    }

    /*///////////////////////////////////////////////////////////////
                        PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Checks if UniswapV3 has a pool for `riskytoken`
     *
     * @param _riskytoken Checks if UniswapV3 has a pool for this address and the `BRIDGE_TOKEN`
     * @return bool If there is a pool or not.
     */
    function _doesPoolExist(address _riskytoken) private view returns (bool) {
        // Save gas
        address wrappedNativeToken = BRIDGE_TOKEN;
        IUniswapV3Factory uniswapV3Factory = IUniswapV3Factory(
            UNISWAP_V3_FACTORY
        );

        bool hasPool;

        // save gas
        uint24[] memory _fees = fees;

        // Loop through all the fees and check if there is a `_riskytoken` and `BRIDGE_TOKEN` pool for the fee
        for (uint256 i; i < _fees.length; i++) {
            address pool = uniswapV3Factory.getPool(
                wrappedNativeToken,
                _riskytoken,
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
     * @dev This updates the interest rate model for the risky token
     *
     * @param interestRateModel The interest rate model for the risky token
     *
     * Requirements:
     *
     * - Only the Int Governance can update this value.
     * - Interest rate model and token cannot be the address zero
     */
    function setRiskyTokenInterestRateModel(address interestRateModel)
        external
        onlyOwner
    {
        require(interestRateModel != address(0), "MD: no zero address");
        riskyTokenInterestRateModel = interestRateModel;
        emit SetInterestRateModel(address(0), interestRateModel);
    }

    /**
     * @dev Allows the Int Governance to update tokens' max LTV.
     *
     * @param token The ERC20 that will have a new LTV
     * @param amount The new LTV
     *
     * Requirements:
     *
     * - Only the owner can update this value to protect the markets agaisnt volatility
     * - MAX LTV is 90% for BTC, Native Token, USDC, USDT
     */
    function setTokenLTV(address token, uint256 amount) external onlyOwner {
        require(0.9e18 >= amount, "MD: LTV too high");
        maxLTVOf[token] = amount;

        emit SetNewTokenLTV(token, amount);
    }

    /**
     * @dev Allows the Int Governance to update the max LTV for the risky asser.
     *
     * @param amount The new LTV
     *
     * Requirements:
     *
     * - Only the owner can update this value to protect the markets agaisnt volatility
     * - MAX LTV is 70% for risky assets.
     */
    function setRiskyTokenLTV(uint256 amount) external onlyOwner {
        require(0.7e18 >= amount, "MD: LTV too high");

        riskyTokenLTV = amount;

        emit SetNewTokenLTV(address(0), amount);
    }
}
