//SPDX-License-Identifier: BSD 3-Clause
pragma solidity 0.8.13;

contract MockUniswapFactoryV3 {
    mapping(address => mapping(address => mapping(uint24 => address)))
        public _pools;

    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool) {
        return _pools[tokenA][tokenB][fee];
    }

    function _addPool(
        address tokenA,
        address tokenB,
        uint24 fee,
        address pool
    ) external {
        _pools[tokenA][tokenB][fee] = pool;
        _pools[tokenB][tokenA][fee] = pool;
    }
}
