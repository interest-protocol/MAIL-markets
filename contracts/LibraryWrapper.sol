//SPDX-License-Identifier: BSD 3-Clause
pragma solidity 0.7.6;

import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

contract LibraryWrapper {
    using OracleLibrary for int24;

    function getQuoteAtTick(
        int24 tick,
        uint128 baseAmount,
        address baseToken,
        address quoteToken
    ) external pure returns (uint256 quoteAmount) {
        return tick.getQuoteAtTick(baseAmount, baseToken, quoteToken);
    }
}
