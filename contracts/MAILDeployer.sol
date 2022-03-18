//SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IMAILDeployer.sol";

import "./MAIL.sol";

contract MAILDeployer is Ownable, IMAILDeployer {
    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable BTC;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable BRIDGE_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable USDC;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable USDT;

    // Address to collect the reserve funds
    address public treasury;

    // % of interest rate to be collected by the treasury
    uint256 public reserveFactor;

    address public riskyAssetInterestRateModel;

    // Risky Token => Market Contract
    mapping(IERC20 => address) public getMarket;

    // Token => Interest Rate Model
    mapping(address => address) public getInterestRateModel;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        IERC20 btc,
        IERC20 bridgeToken,
        IERC20 usdc,
        IERC20 usdt,
        address btcModel,
        address usdcModel,
        address bridgeTokenModel,
        address usdtModel,
        address riskyAssetModel,
        address _treasury,
        uint256 _reserveFactor
    ) {
        require(btcModel != address(0), "btc: no zero address");
        require(usdcModel != address(0), "btc: no zero address");
        require(usdtModel != address(0), "btc: no zero address");
        require(bridgeTokenModel != address(0), "btc: no zero address");
        require(riskyAssetModel != address(0), "btc: no zero address");

        BTC = btc;
        BRIDGE_TOKEN = bridgeToken;
        USDC = usdc;
        USDT = usdt;
        treasury = _treasury;
        reserveFactor = _reserveFactor;

        getInterestRateModel[address(btc)] = btcModel;
        getInterestRateModel[address(usdc)] = usdcModel;
        getInterestRateModel[address(usdt)] = usdtModel;
        getInterestRateModel[address(bridgeToken)] = bridgeTokenModel;

        riskyAssetInterestRateModel = riskyAssetModel;
    }

    /*///////////////////////////////////////////////////////////////
                        MUTATIVE FUNCTIONS  
    //////////////////////////////////////////////////////////////*/

    function deploy(IERC20 riskyAsset) external returns (address market) {
        require(riskyAsset != BTC, "MD: cannot be BTC");
        require(riskyAsset != BRIDGE_TOKEN, "MD: cannot be BRIDGE_TOKEN");
        require(riskyAsset != USDC, "MD: cannot be USDC");
        require(riskyAsset != USDT, "MD: cannot be USDT");
        require(riskyAsset != IERC20(address(0)), "MD: no zero address");

        market = address(
            new MAIL{salt: keccak256(abi.encode(riskyAsset))}(
                BTC,
                BRIDGE_TOKEN,
                USDC,
                USDC,
                riskyAsset
            )
        );

        getMarket[riskyAsset] = market;

        emit MarketCreated(market);
    }

    /*///////////////////////////////////////////////////////////////
                        OWNER ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setReserveFactor(uint256 amount) external onlyOwner {
        require(amount > 0, "MD: no zero amount");
        reserveFactor = amount;
        emit SetReserveFactor(amount);
    }

    function setTreasury(address account) external onlyOwner {
        treasury = account;
        emit SetTreasury(account);
    }

    function setInterestRateModel(IERC20 token, address interestRateModel)
        external
        onlyOwner
    {
        require(address(token) != address(0), "MD: no zero address");
        require(interestRateModel != address(0), "MD: no zero address");
        getInterestRateModel[address(token)] = interestRateModel;
        emit SetInterestRateModel(address(token), interestRateModel);
    }

    function setRiskyAssetInterestRateModel(address interestRateModel)
        external
        onlyOwner
    {
        require(interestRateModel != address(0), "MD: no zero address");
        riskyAssetInterestRateModel = interestRateModel;
        emit SetInterestRateModel(address(0), interestRateModel);
    }
}
