//SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IMAILDeployer.sol";

contract MAIL {
    //solhint-disable-next-line var-name-mixedcase
    address private immutable BTC;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable BRIDGE_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable USDC;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable USDT;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable RISKY_ASSET;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable ORACLE;

    constructor() {
        IMAILDeployer mailDeployer = IMAILDeployer(msg.sender);

        BTC = mailDeployer.BTC();
        BRIDGE_TOKEN = mailDeployer.BRIDGE_TOKEN();
        USDC = mailDeployer.USDC();
        USDT = mailDeployer.USDT();
        RISKY_ASSET = mailDeployer.riskyAsset();
        ORACLE = mailDeployer.ORACLE();
    }
}
