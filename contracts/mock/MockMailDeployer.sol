//SPDX-License-Identifier: BSD 3-Clause
pragma solidity 0.8.13;

contract MockMailDeployer {
    // Array containing all the current fees supported by Uniswap V3
    uint24[] public fees;

    constructor() {
        fees.push(500);
        fees.push(3000);
        fees.push(10000);
    }

    function getFeesLength() external view returns (uint256) {
        return fees.length;
    }
}
