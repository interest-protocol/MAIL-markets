//SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface IMAILDeployer {
    //solhint-disable-next-line func-name-mixedcase
    function BTC() external view returns (address);

    //solhint-disable-next-line func-name-mixedcase
    function BRIDGE_TOKEN() external view returns (address);

    //solhint-disable-next-line func-name-mixedcase
    function USDC() external view returns (address);

    //solhint-disable-next-line func-name-mixedcase
    function USDT() external view returns (address);

    //solhint-disable-next-line func-name-mixedcase
    function ORACLE() external view returns (address);

    //solhint-disable-next-line func-name-mixedcase
    function UNISWAP_V3_FACTORY() external view returns (address);

    function riskyAsset() external view returns (address);

    function getInterestRateModel(address token)
        external
        view
        returns (address);

    function treasury() external view returns (address);

    function reserveFactor() external view returns (uint256);

    function riskyAssetInterestRateModel() external view returns (address);

    function fees(uint256 index) external view returns (uint24);

    event MarketCreated(address indexed market);

    event SetReserveFactor(uint256 amount);

    event SetTreasury(address indexed account);

    event SetInterestRateModel(
        address indexed token,
        address indexed interestRateModel
    );

    event NewUniSwapFee(uint256 indexed fee);
}
