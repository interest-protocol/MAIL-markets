import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { JumpInterestRateModel } from '../typechain';
import { deploy } from './utils/test-utils';

const { parseEther } = ethers.utils;

const BLOCKS_PER_YEAR = 2_102_400;

const BASE_RATE_PER_YEAR = parseEther('0.02');

const MULTIPLIER_PER_YEAR = parseEther('0.1');

const JUMP_MULTIPLIER_PER_YEAR = parseEther('0.15');

const KINK = parseEther('0.7');

describe('JumpInterestRateModel', () => {
  let interestRateModel: JumpInterestRateModel;

  let owner: SignerWithAddress;
  let alice: SignerWithAddress;

  beforeEach(async () => {
    [[owner, alice], interestRateModel] = await Promise.all([
      ethers.getSigners(),
      deploy('JumpInterestRateModel', [
        BASE_RATE_PER_YEAR,
        MULTIPLIER_PER_YEAR,
        JUMP_MULTIPLIER_PER_YEAR,
        KINK,
        BLOCKS_PER_YEAR,
      ]),
    ]);
  });

  it('updates the global variables', async () => {
    const [
      blocksPerYear,
      baseRatePerBlock,
      multiplierPerBlock,
      jumpMultiplierPerBlock,
      kink,
      _owner,
    ] = await Promise.all([
      interestRateModel.BLOCKS_PER_YEAR(),
      interestRateModel.baseRatePerBlock(),
      interestRateModel.multiplierPerBlock(),
      interestRateModel.jumpMultiplierPerBlock(),
      interestRateModel.kink(),
      interestRateModel.owner(),
    ]);

    expect(blocksPerYear).to.be.equal(BLOCKS_PER_YEAR);
    expect(baseRatePerBlock).to.be.equal(
      BASE_RATE_PER_YEAR.div(BLOCKS_PER_YEAR)
    );
    expect(multiplierPerBlock).to.be.equal(
      MULTIPLIER_PER_YEAR.mul(parseEther('1')).div(KINK.mul(BLOCKS_PER_YEAR))
    );
    expect(jumpMultiplierPerBlock).to.be.equal(
      JUMP_MULTIPLIER_PER_YEAR.div(blocksPerYear)
    );
    expect(kink).to.be.equal(KINK);
    expect(_owner).to.be.equal(owner.address);
  });

  it('returns the borrow rate per block', async () => {
    const [
      result,
      result2,
      result3,
      multiplierPerBlock,
      baseRatePerBlock,
      kink,
      jumpMultiplierPerBlock,
    ] = await Promise.all([
      interestRateModel.getBorrowRatePerBlock(
        parseEther('1000000'),
        0,
        parseEther('100000')
      ),
      // Will trigger the kink - 80% utilization rate
      interestRateModel.getBorrowRatePerBlock(
        parseEther('350000'),
        parseEther('600000'),
        parseEther('200000')
      ),
      // Will NOT trigger the kink - 60% utilization rate
      interestRateModel.getBorrowRatePerBlock(
        parseEther('600000'),
        parseEther('600000'),
        parseEther('200000')
      ),
      interestRateModel.multiplierPerBlock(),
      interestRateModel.baseRatePerBlock(),
      interestRateModel.kink(),
      interestRateModel.jumpMultiplierPerBlock(),
    ]);

    expect(result).to.be.equal(baseRatePerBlock);
    expect(result2).to.be.equal(
      kink
        .mul(multiplierPerBlock)
        .div(parseEther('1'))
        .add(baseRatePerBlock)
        .add(
          parseEther('0.8')
            .sub(kink)
            .mul(jumpMultiplierPerBlock)
            .div(parseEther('1'))
        )
    );
    expect(result3).to.be.equal(
      parseEther('0.6')
        .mul(multiplierPerBlock)
        .div(parseEther('1'))
        .add(baseRatePerBlock)
    );
  });

  it('returns the supply rate per block', async () => {
    const [
      result,
      result2,
      multiplierPerBlock,
      baseRatePerBlock,
      kink,
      jumpMultiplierPerBlock,
    ] = await Promise.all([
      interestRateModel.getSupplyRatePerBlock(
        parseEther('1000000'),
        0,
        parseEther('100000'),
        parseEther('0.2')
      ),
      interestRateModel.getSupplyRatePerBlock(
        parseEther('350000'),
        parseEther('600000'),
        parseEther('200000'),
        parseEther('0.3')
      ),
      interestRateModel.multiplierPerBlock(),
      interestRateModel.baseRatePerBlock(),
      interestRateModel.kink(),
      interestRateModel.jumpMultiplierPerBlock(),
    ]);

    // 1 - reserveFactor
    const investorFactor2 = parseEther('0.7');

    expect(result).to.be.equal(0);
    expect(result2).to.be.equal(
      parseEther('0.8')
        .mul(
          kink
            .mul(multiplierPerBlock)
            .div(parseEther('1'))
            .add(baseRatePerBlock)
            .add(
              parseEther('0.8')
                .sub(kink)
                .mul(jumpMultiplierPerBlock)
                .div(parseEther('1'))
            )
            .mul(investorFactor2)
            .div(parseEther('1'))
        )
        .div(parseEther('1'))
    );
  });

  describe('function: updateJumpRateModel', () => {
    it('reverts if it is called by any account other than the owner', async () => {
      await expect(
        interestRateModel.connect(alice).updateJumpRateModel(0, 0, 0, 0)
      ).to.revertedWith('Ownable: caller is not the owner');
    });
    it('updates the global variables of the interest rate model', async () => {
      await expect(
        interestRateModel
          .connect(owner)
          .updateJumpRateModel(
            parseEther('0.03'),
            parseEther('0.2'),
            parseEther('0.3'),
            parseEther('0.5')
          )
      )
        .to.emit(interestRateModel, 'NewJumpRateModelVars')
        .withArgs(
          parseEther('0.03').div(BLOCKS_PER_YEAR),
          parseEther('0.2')
            .mul(parseEther('1'))
            .div(parseEther('0.5').mul(BLOCKS_PER_YEAR)),
          parseEther('0.3').div(BLOCKS_PER_YEAR),
          parseEther('0.5')
        );
    });
  });
});
