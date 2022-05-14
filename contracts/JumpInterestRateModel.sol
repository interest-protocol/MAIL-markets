/**
Copyright 2020 Compound Labs, Inc.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
© 2022 GitHub, Inc.
 */

//SPDX-License-Identifier: BSD 3-Clause
pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./lib/IntMath.sol";

contract JumpInterestRateModel is Ownable {
    /*///////////////////////////////////////////////////////////////
                                EVENT 
    //////////////////////////////////////////////////////////////*/

    event NewJumpRateModelVars(
        uint256 indexed baseRatePerBlock,
        uint256 indexed multiplierPerBlock,
        uint256 jumpMultiplierPerBlock,
        uint256 indexed _kink
    );

    /*///////////////////////////////////////////////////////////////
                              LIBRARIES 
    //////////////////////////////////////////////////////////////*/

    using IntMath for uint256;

    /*///////////////////////////////////////////////////////////////
                              STATE
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev The Interest rate charged every block regardless of utilization rate
     */
    //solhint-disable-next-line var-name-mixedcase
    uint256 public immutable BLOCKS_PER_YEAR;

    /**
     * @dev The Interest rate charged every block regardless of utilization rate
     */
    uint256 public baseRatePerBlock;

    /**
     * @dev The Interest rate added as a percentage of the utilization rate.
     */
    uint256 public multiplierPerBlock;

    /**
     * @dev The multiplierPerBlock after hitting a specified utilization point
     */
    uint256 public jumpMultiplierPerBlock;

    /**
     * @dev The utilization point at which the jump multiplier is applied
     */
    uint256 public kink;

    /**
     *
     */
    constructor(
        uint256 baseRatePerYear,
        uint256 multiplierPerYear,
        uint256 jumpMultiplierPerYear,
        uint256 _kink,
        uint256 blocksPerYear
    ) {
        _updateJumpRateModel(
            baseRatePerYear,
            multiplierPerYear,
            jumpMultiplierPerYear,
            _kink,
            blocksPerYear
        );

        BLOCKS_PER_YEAR = blocksPerYear;
    }

    /*///////////////////////////////////////////////////////////////
                              VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Calculates the borrow rate for a lending market
     *
     * @param cash The avaliable liquidity to be borrowed
     * @param totalBorrowAmount The total amount being borrowed
     * @param reserves Amount of cash that belongs to the reserves.
     */
    function getBorrowRatePerBlock(
        uint256 cash,
        uint256 totalBorrowAmount,
        uint256 reserves
    ) external view returns (uint256) {
        return _getBorrowRatePerBlock(cash, totalBorrowAmount, reserves);
    }

    /**
     * @dev Calculates the supply rate for a lending market using the borrow and utilization rate.
     *
     * @param cash The avaliable liquidity to be borrowed
     * @param totalBorrowAmount The total amount being borrowed
     * @param reserves Amount of cash that belongs to the reserves.
     * @param reserveFactor The % of the interest rate that is to be used for reserves.
     */
    function getSupplyRatePerBlock(
        uint256 cash,
        uint256 totalBorrowAmount,
        uint256 reserves,
        uint256 reserveFactor
    ) external view returns (uint256) {
        uint256 investorsFactor = 1 ether - reserveFactor;
        uint256 borrowRate = _getBorrowRatePerBlock(
            cash,
            totalBorrowAmount,
            reserves
        );
        uint256 borrowRateToInvestors = borrowRate.bmul(investorsFactor);
        return
            _getUtilizationRate(cash, totalBorrowAmount, reserves).bmul(
                borrowRateToInvestors
            );
    }

    /*///////////////////////////////////////////////////////////////
                              INTERNAL
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Internal function to calculate the borrow rate for a lending market
     *
     * @param cash The avaliable liquidity to be borrowed
     * @param totalBorrowAmount The total amount being borrowed
     * @param reserves Amount of cash that belongs to the reserves.
     */
    function _getBorrowRatePerBlock(
        uint256 cash,
        uint256 totalBorrowAmount,
        uint256 reserves
    ) private view returns (uint256) {
        // Get utilization rate
        uint256 utilRate = _getUtilizationRate(
            cash,
            totalBorrowAmount,
            reserves
        );

        // Save Gas
        uint256 _kink = kink;

        // If we are below the kink threshold
        if (_kink >= utilRate)
            return utilRate.bmul(multiplierPerBlock) + baseRatePerBlock;

        // Anything equal and below the kink is charged the normal rate
        uint256 normalRate = _kink.bmul(multiplierPerBlock) + baseRatePerBlock;
        // % of the utility rate that is above the threshold
        uint256 excessUtil = utilRate - _kink;
        return excessUtil.bmul(jumpMultiplierPerBlock) + normalRate;
    }

    /**
     * @dev Calculates how much supply minus reserved is being borrowed.
     *
     * @param cash The avaliable liquidity to be borrowed
     * @param totalBorrowAmount The total amount being borrowed
     * @param reserves Amount of cash that belongs to the reserves.
     */
    function _getUtilizationRate(
        uint256 cash,
        uint256 totalBorrowAmount,
        uint256 reserves
    ) private pure returns (uint256) {
        if (totalBorrowAmount == 0) return 0;

        return totalBorrowAmount.bdiv((cash + totalBorrowAmount) - reserves);
    }

    function _updateJumpRateModel(
        uint256 baseRatePerYear,
        uint256 multiplierPerYear,
        uint256 jumpMultiplierPerYear,
        uint256 _kink,
        uint256 blocksPerYear
    ) private {
        baseRatePerBlock = baseRatePerYear / blocksPerYear;

        multiplierPerBlock = multiplierPerYear.bdiv((blocksPerYear * _kink));

        jumpMultiplierPerBlock = jumpMultiplierPerYear / blocksPerYear;

        kink = _kink;
    }

    /*///////////////////////////////////////////////////////////////
                              ONLY OWNER
    //////////////////////////////////////////////////////////////*/

    function updateJumpRateModel(
        uint256 baseRatePerYear,
        uint256 multiplierPerYear,
        uint256 jumpMultiplierPerYear,
        uint256 _kink
    ) external onlyOwner {
        _updateJumpRateModel(
            baseRatePerYear,
            multiplierPerYear,
            jumpMultiplierPerYear,
            _kink,
            BLOCKS_PER_YEAR
        );

        emit NewJumpRateModelVars(
            baseRatePerBlock,
            multiplierPerBlock,
            jumpMultiplierPerBlock,
            kink
        );
    }
}
