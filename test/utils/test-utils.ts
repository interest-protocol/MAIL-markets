/* eslint-disable  @typescript-eslint/no-explicit-any */
// eslint-disable-next-line node/no-unpublished-import
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ContractAddressOrInstance } from '@openzeppelin/hardhat-upgrades/dist/utils';
import { ethers, network, upgrades } from 'hardhat';

export const multiDeploy = async (
  x: ReadonlyArray<string>,
  y: Array<Array<unknown> | undefined> = []
): Promise<any> => {
  const contractFactories = await Promise.all(
    x.map((name) => ethers.getContractFactory(name))
  );

  return Promise.all(
    contractFactories.map((factory, index) =>
      factory.deploy(...(y[index] || []))
    )
  );
};

export const deploy = async (
  name: string,
  parameters: Array<unknown> = []
): Promise<any> => {
  const factory = await ethers.getContractFactory(name);
  return await factory.deploy(...parameters);
};

export const deployUUPS = async (
  name: string,
  parameters: Array<unknown> = []
): Promise<any> => {
  const factory = await ethers.getContractFactory(name);
  const instance = await upgrades.deployProxy(factory, parameters, {
    kind: 'uups',
  });
  await instance.deployed();
  return instance;
};

export const multiDeployUUPS = async (
  name: ReadonlyArray<string>,
  parameters: Array<Array<unknown> | undefined> = []
): Promise<any> => {
  const factories = await Promise.all(
    name.map((x) => ethers.getContractFactory(x))
  );

  const instances = await Promise.all(
    factories.map((factory, index) =>
      upgrades.deployProxy(factory, parameters[index], { kind: 'uups' })
    )
  );

  await Promise.all([instances.map((x) => x.deployed())]);

  return instances;
};

export const advanceTime = (
  time: number,
  _ethers: typeof ethers
): Promise<void> => _ethers.provider.send('evm_increaseTime', [time]);

export const advanceBlock = (_ethers: typeof ethers): Promise<void> =>
  _ethers.provider.send('evm_mine', []);

export const advanceBlockAndTime = async (
  time: number,
  _ethers: typeof ethers
): Promise<void> => {
  await _ethers.provider.send('evm_increaseTime', [time]);
  await _ethers.provider.send('evm_mine', []);
};

export const upgrade = async (
  proxy: ContractAddressOrInstance,
  name: string
): Promise<any> => {
  const factory = await ethers.getContractFactory(name);
  return upgrades.upgradeProxy(proxy, factory);
};

export const impersonate = async (
  address: string
): Promise<SignerWithAddress> => {
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });

  return ethers.getSigner(address);
};

export const parseUSDC = (x: string) =>
  ethers.BigNumber.from(x).mul(ethers.BigNumber.from(10).pow(6));

export const parseUSDT = (x: string) =>
  ethers.BigNumber.from(x).mul(ethers.BigNumber.from(10).pow(6));

export const parseWBTC = (x: string) =>
  ethers.BigNumber.from(x).mul(ethers.BigNumber.from(10).pow(8));
