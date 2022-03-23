/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { ethers } from "ethers";
import {
  FactoryOptions,
  HardhatEthersHelpers as HardhatEthersHelpersBase,
} from "@nomiclabs/hardhat-ethers/types";

import * as Contracts from ".";

declare module "hardhat/types/runtime" {
  interface HardhatEthersHelpers extends HardhatEthersHelpersBase {
    getContractFactory(
      name: "Ownable",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.Ownable__factory>;
    getContractFactory(
      name: "IERC20",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IERC20__factory>;
    getContractFactory(
      name: "IUniswapV3Factory",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IUniswapV3Factory__factory>;
    getContractFactory(
      name: "IMAILDeployer",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.IMAILDeployer__factory>;
    getContractFactory(
      name: "JumpInterestRateModel",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.JumpInterestRateModel__factory>;
    getContractFactory(
      name: "MAIL",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.MAIL__factory>;
    getContractFactory(
      name: "MAILDeployer",
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<Contracts.MAILDeployer__factory>;

    getContractAt(
      name: "Ownable",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.Ownable>;
    getContractAt(
      name: "IERC20",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IERC20>;
    getContractAt(
      name: "IUniswapV3Factory",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IUniswapV3Factory>;
    getContractAt(
      name: "IMAILDeployer",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.IMAILDeployer>;
    getContractAt(
      name: "JumpInterestRateModel",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.JumpInterestRateModel>;
    getContractAt(
      name: "MAIL",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.MAIL>;
    getContractAt(
      name: "MAILDeployer",
      address: string,
      signer?: ethers.Signer
    ): Promise<Contracts.MAILDeployer>;

    // default types
    getContractFactory(
      name: string,
      signerOrOptions?: ethers.Signer | FactoryOptions
    ): Promise<ethers.ContractFactory>;
    getContractFactory(
      abi: any[],
      bytecode: ethers.utils.BytesLike,
      signer?: ethers.Signer
    ): Promise<ethers.ContractFactory>;
    getContractAt(
      nameOrAbi: string | any[],
      address: string,
      signer?: ethers.Signer
    ): Promise<ethers.Contract>;
  }
}
