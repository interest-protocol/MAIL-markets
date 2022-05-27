import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';

import { LibraryWrapper, Oracle, OracleV2 } from '../typechain';
import { BTC_CHAIN_LINK_FEED, SHIBA_INU, WBTC } from './utils/constants';
import { deploy, deployUUPS, upgrade } from './utils/test-utils';
const { parseEther } = ethers.utils;

describe('Oracle', () => {
  let oracle: Oracle;
  let libraryWrapper: LibraryWrapper;

  let owner: SignerWithAddress;
  let alice: SignerWithAddress;

  beforeEach(async () => {
    [[owner, alice], libraryWrapper] = await Promise.all([
      ethers.getSigners(),
      deploy('LibraryWrapper', []),
    ]);

    oracle = await deployUUPS('Oracle', [libraryWrapper.address]);

    await oracle.connect(owner).setFeed(WBTC, BTC_CHAIN_LINK_FEED);
  });

  it.only('fetches the ETH price of a token from UniswapV3 TWAP', async () => {
    const shibaInuPrice = await oracle.getUNIV3Price(
      SHIBA_INU,
      parseEther('1')
    );
    // Check afterwards and is close to price on CMC for $0.00002008 ~ 7337530445 * 3000 / 1e18
    expect(shibaInuPrice.gt(BigNumber.from('7007530445'))).to.be.equal(true);
  });

  it('fetches the ETH price of a token from chainlink', async () => {
    const btcPrice = await oracle.getETHPrice(WBTC, parseEther('2'));
    // Taken after the fact but it is properly calculated. as it has 18 decimals and represents ~79k usd if we assume ETH is 3k
    // 26594973420000000000 * 3000 /1e18
    expect(btcPrice).to.be.equal('26594973420000000000');
  });

  it('allows to get the chainlink feed for a specific token', async () => {
    expect(await oracle.getETHFeeds(WBTC)).to.be.equal(BTC_CHAIN_LINK_FEED);
  });

  it('allows the owner to update the feeds', async () => {
    await expect(
      oracle.connect(alice).setFeed(WBTC, alice.address)
    ).to.revertedWith('Ownable: caller is not the owner');

    await oracle.connect(owner).setFeed(WBTC, alice.address);

    expect(await oracle.getETHFeeds(WBTC)).to.be.equal(alice.address);
  });

  it('allows the owner to add a new uniswap fee', async () => {
    expect(await oracle.getFeesLength()).to.be.equal(3);

    await expect(oracle.connect(owner).addUniswapV3Fee(500)).to.be.revertedWith(
      'Oracle: fee already added'
    );

    await expect(oracle.connect(owner).addUniswapV3Fee(2000))
      .to.emit(oracle, 'NewUniSwapFee')
      .withArgs(2000);

    expect(await oracle.getFee(3)).to.be.equal(2000);
  });

  describe('Update to new contract', () => {
    it('reverts if a non owner tries to update it', async () => {
      await oracle.connect(owner).renounceOwnership();

      await expect(upgrade(oracle.address, 'OracleV2')).to.revertedWith(
        'Ownable: caller is not the owner'
      );
    });
    it('upgrades to version 2', async () => {
      const oracleV2: OracleV2 = await upgrade(oracle.address, 'OracleV2');

      const [version, feed] = await Promise.all([
        oracleV2.version(),
        oracleV2.getETHFeeds(WBTC),
      ]);

      expect(version).to.be.equal('V2');
      expect(feed).to.be.equal(BTC_CHAIN_LINK_FEED);
    });
  });
});
