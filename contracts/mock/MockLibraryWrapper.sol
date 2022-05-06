//SPDX-License-Identifier: BSD 3-Clause
pragma solidity 0.8.13;

contract MockLibraryWrapper {
    mapping(address => int24) public _arithmeticMeanTick;

    mapping(address => uint128) public _harmonicMeanLiquidity;

    mapping(int24 => mapping(address => uint256)) public _quoteAmount;

    function consult(address pool, uint32)
        external
        view
        returns (int24 arithmeticMeanTick, uint128 harmonicMeanLiquidity)
    {
        return (_arithmeticMeanTick[pool], _harmonicMeanLiquidity[pool]);
    }

    function getQuoteAtTick(
        int24 tick,
        uint128,
        address baseToken,
        address
    ) internal view returns (uint256 quoteAmount) {
        return _quoteAmount[tick][baseToken];
    }

    function _setArithmeticMeanTick(address pool, int24 arithmeticMeanTick)
        external
    {
        _arithmeticMeanTick[pool] = arithmeticMeanTick;
    }

    function _setHarmonicMeanLiquidity(
        address pool,
        uint128 harmonicMeanLiquidity
    ) external {
        _harmonicMeanLiquidity[pool] = harmonicMeanLiquidity;
    }

    function _setQuoteAmount(
        int24 arithmeticMeanTick,
        address baseToken,
        uint256 quoteAmount
    ) external {
        _quoteAmount[arithmeticMeanTick][baseToken] = quoteAmount;
    }
}
