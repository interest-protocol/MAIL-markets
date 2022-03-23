//SPDX-License-Identifier: BSD 3-Clause
pragma solidity 0.7.6;

import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

contract LibraryWrapper {
    using OracleLibrary for address;
    using OracleLibrary for int24;

    function consult(address pool, uint32 secondsAgo)
        external
        view
        returns (int24 arithmeticMeanTick, uint128 harmonicMeanLiquidity)
    {
        return pool.consult(secondsAgo);
    }

    function getQuoteAtTick(
        int24 tick,
        uint128 baseAmount,
        address baseToken,
        address quoteToken
    ) internal pure returns (uint256 quoteAmount) {
        return tick.getQuoteAtTick(baseAmount, baseToken, quoteToken);
    }
}
