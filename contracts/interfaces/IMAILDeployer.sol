//SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface IMAILDeployer {
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
