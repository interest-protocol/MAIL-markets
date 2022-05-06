//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IMAILDeployer {
    //solhint-disable-next-line func-name-mixedcase
    function ROUTER() external view returns (address);

    //solhint-disable-next-line func-name-mixedcase
    function ORACLE() external view returns (address);

    function riskyToken() external view returns (address);

    function getInterestRateModel(address token)
        external
        view
        returns (address);

    function treasury() external view returns (address);

    function reserveFactor() external view returns (uint256);

    function riskyTokenInterestRateModel() external view returns (address);

    function fees(uint256 index) external view returns (uint24);

    function getFeesLength() external view returns (uint256);

    function riskyTokenLTV() external view returns (uint256);

    function maxLTVOf(address token) external view returns (uint256);

    function liquidationFee() external view returns (uint256);

    function liquidatorPortion() external view returns (uint256);

    event MarketCreated(address indexed market);

    event SetReserveFactor(uint256 amount);

    event SetTreasury(address indexed account);

    event SetInterestRateModel(
        address indexed token,
        address indexed interestRateModel
    );

    event NewUniSwapFee(uint256 indexed fee);

    event SetNewTokenLTV(address indexed token, uint256 amount);

    event SetLiquidationFee(uint256 indexed fee);

    event SetLiquidatorPortion(uint256 indexed portion);
}
