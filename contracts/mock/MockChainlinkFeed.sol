// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

contract MockChainLinkFeed {
    int256 public price;

    function setPrice(int256 _price) external {
        price = _price;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        // Taken from https://bscscan.com/address/0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee#readContract
        roundId = 36893488147419307956;
        answer = price;
        startedAt = 1639814685;
        updatedAt = 1639814685;
        answeredInRound = 36893488147419307956;
    }
}
