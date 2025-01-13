import { ethers } from 'hardhat'
import { ContractFactory, Contract, Overrides, BigNumber } from 'ethers'
import '@nomiclabs/hardhat-ethers'
import { run } from 'hardhat'
import {
  abi as UpgradeExecutorABI,
  bytecode as UpgradeExecutorBytecode,
} from '@offchainlabs/upgrade-executor/build/contracts/src/UpgradeExecutor.sol/UpgradeExecutor.json'
import { Toolkit4844 } from '../test/contract/toolkit4844'
import { ArbSys__factory } from '../build/types'
import { ARB_SYS_ADDRESS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { Provider, TransactionReceipt } from '@ethersproject/providers'

// Define a verification function
export async function verifyContract(
  contractName: string,
  contractAddress: string,
  constructorArguments: any[] = [],
  contractPathAndName?: string // optional
): Promise<void> {
  try {
    if (process.env.DISABLE_VERIFICATION) return
    // Define the verification options with possible 'contract' property
    const verificationOptions: {
      contract?: string
      address: string
      constructorArguments: any[]
    } = {
      address: contractAddress,
      constructorArguments: constructorArguments,
    }

    // if contractPathAndName is provided, add it to the verification options
    if (contractPathAndName) {
      verificationOptions.contract = contractPathAndName
    }

    await run('verify:verify', verificationOptions)
    console.log(`Verified contract ${contractName} successfully.`)
  } catch (error: any) {
    if (error.message.includes('Already Verified')) {
      console.log(`Contract ${contractName} is already verified.`)
    } else {
      console.error(
        `Verification for ${contractName} failed with the following error: ${error.message}`
      )
    }
  }
}

// Function to handle contract deployment
export async function deployContract(
  contractName: string,
  signer: any,
  constructorArgs: any[] = [],
  verify: boolean = true,
  overrides?: Overrides
): Promise<Contract> {
  const factory: ContractFactory = await ethers.getContractFactory(contractName)
  const connectedFactory: ContractFactory = factory.connect(signer)

  let deploymentArgs = [...constructorArgs]
  if (overrides) {
    deploymentArgs.push(overrides)
  }

  try {
    const contract:Contract = await connectedFactory.deploy(...deploymentArgs)
    await contract.deployTransaction.wait()
    console.log(`New ${contractName} created at address:`, contract.address)
  
    if (verify)
      await verifyContract(contractName, contract.address, constructorArgs)
  
    return contract
  } catch (error:any) {
    if(error?.transactionHash) {
      const receipt = await WaitTxReceiptByHash(signer.provider,error.transactionHash,`deploy ${contractName}`)
      if(!receipt) {
        throw error;
      }
      return connectedFactory.attach(receipt.contractAddress).connect(signer)
    } else {
      throw error
    }
  }
}

// Deploy upgrade executor from imported bytecode
export async function deployUpgradeExecutor(signer: any): Promise<Contract> {
  const upgradeExecutorFac = await ethers.getContractFactory(
    UpgradeExecutorABI,
    UpgradeExecutorBytecode
  )
  const connectedFactory: ContractFactory = upgradeExecutorFac.connect(signer)

  try {
    const upgradeExecutor = await connectedFactory.deploy()
    return upgradeExecutor
  } catch (error:any) {
    if(error?.transactionHash) {
      const is = await WaitTxReceiptByHash(signer.provider,error.transactionHash,`deploy UpgradeExecutor`)
      if(!is) {
        throw error;
      }
      return connectedFactory.attach(is.contractAddress).connect(signer)
    } else {
      throw error
    }
  }
}

// Function to handle all deployments of core contracts using deployContract function
export async function deployAllContracts(
  signer: any,
  maxDataSize: BigNumber,
  verify: boolean = true
): Promise<Record<string, Contract>> {
  const isOnArb = await _isRunningOnArbitrum(signer)

  const ethBridge = await deployContract('Bridge', signer, [], verify)
  const reader4844 = isOnArb
    ? ethers.constants.AddressZero
    : (await Toolkit4844.deployReader4844(signer)).address

  const ethSequencerInbox = await deployContract(
    'SequencerInbox',
    signer,
    [maxDataSize, reader4844, false],
    verify
  )

  const ethInbox = await deployContract('Inbox', signer, [maxDataSize], verify)
  const ethRollupEventInbox = await deployContract(
    'RollupEventInbox',
    signer,
    [],
    verify
  )
  const ethOutbox = await deployContract('Outbox', signer, [], verify)

  const erc20Bridge = await deployContract('ERC20Bridge', signer, [], verify)
  const erc20SequencerInbox = await deployContract(
    'SequencerInbox',
    signer,
    [maxDataSize, reader4844, true],
    verify
  )
  const erc20Inbox = await deployContract(
    'ERC20Inbox',
    signer,
    [maxDataSize],
    verify
  )
  const erc20RollupEventInbox = await deployContract(
    'ERC20RollupEventInbox',
    signer,
    [],
    verify
  )
  const erc20Outbox = await deployContract('ERC20Outbox', signer, [], verify)

  const bridgeCreator = await deployContract(
    'BridgeCreator',
    signer,
    [
      [
        ethBridge.address,
        ethSequencerInbox.address,
        ethInbox.address,
        ethRollupEventInbox.address,
        ethOutbox.address,
      ],
      [
        erc20Bridge.address,
        erc20SequencerInbox.address,
        erc20Inbox.address,
        erc20RollupEventInbox.address,
        erc20Outbox.address,
      ],
    ],
    verify
  )
  const prover0 = await deployContract('OneStepProver0', signer, [], verify)
  const proverMem = await deployContract(
    'OneStepProverMemory',
    signer,
    [],
    verify
  )
  const proverMath = await deployContract(
    'OneStepProverMath',
    signer,
    [],
    verify
  )
  const proverHostIo = await deployContract(
    'OneStepProverHostIo',
    signer,
    [],
    verify
  )
  const osp: Contract = await deployContract(
    'OneStepProofEntry',
    signer,
    [
      prover0.address,
      proverMem.address,
      proverMath.address,
      proverHostIo.address,
    ],
    verify
  )
  const challengeManager = await deployContract(
    'ChallengeManager',
    signer,
    [],
    verify
  )
  const rollupAdmin = await deployContract(
    'RollupAdminLogic',
    signer,
    [],
    verify
  )
  const rollupUser = await deployContract('RollupUserLogic', signer, [], verify)

  const upgradeExecutor = await deployUpgradeExecutor(signer)
  await upgradeExecutor.deployTransaction.wait()

  const validatorUtils = await deployContract(
    'ValidatorUtils',
    signer,
    [],
    verify
  )
  const validatorWalletCreator = await deployContract(
    'ValidatorWalletCreator',
    signer,
    [],
    verify
  )
  const rollupCreator = await deployContract(
    'RollupCreator',
    signer,
    [],
    verify
  )
  const deployHelper = await deployContract('DeployHelper', signer, [], verify)
  return {
    bridgeCreator,
    prover0,
    proverMem,
    proverMath,
    proverHostIo,
    osp,
    challengeManager,
    rollupAdmin,
    rollupUser,
    upgradeExecutor,
    validatorUtils,
    validatorWalletCreator,
    rollupCreator,
    deployHelper,
  }
}

// Check if we're deploying to an Arbitrum chain
export async function _isRunningOnArbitrum(signer: any): Promise<boolean> {
  const arbSys = ArbSys__factory.connect(ARB_SYS_ADDRESS, signer)
  try {
    await arbSys.arbOSVersion()
    return true
  } catch (error) {
    return false
  }
}

export async function WaitTxReceiptByHash(provider:Provider ,txHash:any, action:string) : Promise<TransactionReceipt|undefined> {
  const receipt = await provider.waitForTransaction(txHash,undefined,90000); // timeout will throw error
  console.log(`>>> Generated error when ${action}, but get tx receipt: ${receipt.transactionHash}`);
  if (receipt.status == 0) {
    console.log(">>> But tx receipt status is fail");
    throw undefined;
  }
  console.log(`>>> ${action} tx status is success`);
  return receipt
}