//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IOracle {
    function getETHPrice(address token, uint256 amount)
        external
        view
        returns (uint256);

    function getRiskytokenPrice(address riskytoken, uint256 amount)
        external
        view
        returns (uint256);
}
