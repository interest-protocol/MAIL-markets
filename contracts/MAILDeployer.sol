//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import "./interfaces/IMAILDeployer.sol";

import "./MAIL.sol";

/**
 * @notice It is meant to run on Ethereum
 */
contract MAILDeployer is Ownable, IMAILDeployer {
    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    uint256 private constant INITIAL_MAX_LTV = 0.5e18;

    //solhint-disable-next-line var-name-mixedcase
    address private constant UNISWAP_V3_FACTORY =
        0x1F98431c8aD98523631AE4a59f267346ea31F984;

    //solhint-disable-next-line var-name-mixedcase
    address private constant BTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    //solhint-disable-next-line var-name-mixedcase
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    //solhint-disable-next-line var-name-mixedcase
    address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    //solhint-disable-next-line var-name-mixedcase
    address private constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable ORACLE;

    //solhint-disable-next-line var-name-mixedcase
    address public immutable ROUTER;

    address public riskyToken;

    // Address to collect the reserve funds
    address public treasury;

    // % of interest rate to be collected by the treasury
    uint256 public reserveFactor;

    // Contract to calculate borrow and supply rate for the risky token
    address public riskyTokenInterestRateModel;

    uint256 public riskyTokenLTV;

    uint256 public liquidationFee;

    uint256 public liquidatorPortion;

    // Risky Token => Market Contract
    mapping(address => address) public getMarket;

    // Token => Interest Rate Model (BTC/USDC/USDT/BRIDGE_TOKEN)
    mapping(address => address) public getInterestRateModel;

    // Token => LTV
    mapping(address => uint256) public maxLTVOf;

    // FEE -> BOOL A mapping to prevent duplicates to the `_fees` array
    mapping(uint256 => bool) private _hasFee;

    // Array containing all the current _fees supported by Uniswap V3
    uint24[] private _fees;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param oracle The oracle used by MAIL lending markets
     * @param _treasury The address that will collect all protocol _fees
     * @param _reserveFactor The % of the interest rate that will be sent to the treasury. It is a 18 mantissa number
     * @param modelData Data about the interest rate models for usdc, btc, wrappedNativeToken, usdt and risky token
     *
     * Requirements:
     *
     * - None of the tokens, interest rate models and oracle can be the zero address
     */
    constructor(
        address oracle,
        address _router,
        address _treasury,
        uint256 _reserveFactor,
        bytes memory modelData
    ) {
        // Update Global state
        ORACLE = oracle;
        ROUTER = _router;

        treasury = _treasury;
        reserveFactor = _reserveFactor;
        liquidatorPortion = 0.98e18; // 98%
        liquidationFee = 0.15e18; // 15%

        _initializeFees();

        _initializeModels(modelData);

        _initializeMAXLTV();
    }

    /*///////////////////////////////////////////////////////////////
                                    VIEW 
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Total amount of _fees supported by UniswapV3
     * @return uint256 The number of _fees
     */
    function getFeesLength() external view returns (uint256) {
        return _fees.length;
    }

    /**
     * @dev To find a fee at a specific index.
     *
     * @param index of the corresponding fee
     * @return uint24 fee for the index
     */
    function getFee(uint256 index) external view returns (uint24) {
        return _fees[index];
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
        bytes32 salt = keccak256(abi.encodePacked(_riskytoken));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(MAILMarket).creationCode)
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
        require(_riskyToken != WETH, "MD: cannot be WETH");
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
            new MAILMarket{salt: keccak256(abi.encodePacked(_riskyToken))}()
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
        address weth = WETH;
        IUniswapV3Factory uniswapV3Factory = IUniswapV3Factory(
            UNISWAP_V3_FACTORY
        );

        bool hasPool;

        // save gas
        uint24[] memory __fees = _fees;

        // Loop through all the _fees and check if there is a `_riskytoken` and `BRIDGE_TOKEN` pool for the fee
        for (uint256 i; i < __fees.length; i++) {
            address pool = uniswapV3Factory.getPool(
                weth,
                _riskytoken,
                __fees[i]
            );
            if (pool != address(0)) {
                hasPool = true;
                break;
            }
        }

        return hasPool;
    }

    /*///////////////////////////////////////////////////////////////
                        PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev An initializer to set the current _fees supported by Uniswap. Done to avoid stock local variable limit
     */
    function _initializeFees() private {
        // Add current supported UniswapV3 _fees
        _fees.push(500);
        _fees.push(3000);
        _fees.push(10000);

        // Update the guard map
        _hasFee[500] = true;
        _hasFee[3000] = true;
        _hasFee[10000] = true;
    }

    /**
     * @dev An initializer to set the max ltv per asset. Done to avoid stack local variable limit
     */
    function _initializeMAXLTV() private {
        // Set Initial LTV
        maxLTVOf[BTC] = INITIAL_MAX_LTV;
        maxLTVOf[USDC] = INITIAL_MAX_LTV;
        maxLTVOf[USDT] = INITIAL_MAX_LTV;
        maxLTVOf[WETH] = INITIAL_MAX_LTV;
        riskyTokenLTV = INITIAL_MAX_LTV;
    }

    /**
     * @dev An initializer to set the interest rate models of the assets. Done to avoid stack local variable limit
     */
    function _initializeModels(bytes memory modelData) private {
        (
            address btcModel,
            address usdcModel,
            address ethModel,
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
        require(ethModel != address(0), "eth: no zero address");
        require(riskytokenModel != address(0), "ra: no zero address");

        // Map the token to the right interest rate model
        getInterestRateModel[BTC] = btcModel;
        getInterestRateModel[USDC] = usdcModel;
        getInterestRateModel[USDT] = usdtModel;
        getInterestRateModel[WETH] = ethModel;
        riskyTokenInterestRateModel = riskytokenModel;
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
        require(!_hasFee[fee], "MD: uni fee already added");
        _hasFee[fee] = true;
        _fees.push(fee);
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
        require(amount <= 0.25 ether, "MD: too  high");
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

    /**
     * @dev Allows the Int Governance to update the liquidation fee.
     *
     * @param fee The new liquidation fee
     *
     * Requirements:
     *
     * - Only Int Governance can update this value
     */
    function setLiquidationFee(uint256 fee) external onlyOwner {
        require(fee > 0 && fee <= 0.3e18, "MD: fee out of bounds");
        liquidationFee = fee;

        emit SetLiquidationFee(fee);
    }

    /**
     * @dev Allows the Int Governance to update the liquidator portion
     *
     * @param portion The new liquidator portion
     *
     * Requirements:
     *
     * - Only Int Governance can update this value
     */
    function setLiquidatorPortion(uint256 portion) external onlyOwner {
        require(portion > 0.95e18, "MD: too low");
        liquidatorPortion = portion;

        emit SetLiquidatorPortion(portion);
    }
}
