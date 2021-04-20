import { Signer } from 'ethers'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { PostEverpayTxResult } from './api/interface'

export enum ChainType {
  ethereum = 'ethereum'
}
export interface Config {
  debug?: boolean
  account?: string
  connectedSigner?: Signer
}

export interface Token {
  id: string
  symbol: string
  decimals: number
  totalSupply: number
  chainType: ChainType
}

export interface EverpayInfo {
  ethLocker: string
  owner: string
  txVersion: string
  ethChainID: string
  feeRecipient: string
  tokenList: Token[]
}

export enum EverpayAction {
  transfer = 'transfer',
  withdraw = 'burn',
  // TODO: for test
  // deposit = 'mint'
}

export interface EverpayTxWithoutSig {
  tokenSymbol: string
  action: EverpayAction
  from: string
  to: string
  amount: string
  fee: string
  feeRecipient: string
  nonce: string
  tokenID: string
  chainType: ChainType
  data: string
  version: string
}

export interface EverpayTx extends EverpayTxWithoutSig {
  sig: string
}

enum EverpayActionWithDeposit {
  transfer = 'transfer',
  withdraw = 'burn',
  deposit = 'mint'
}

enum EverpayTransactionStatus {
  // deposit 下，经过 6 个区块 everPay confirm
  // mint、burn，后端接收到信息，会先 confirmed
  confirmed = 'confirmed',
  // JSON 文件存储交易打包完成，变成 packaged
  packaged = 'packaged'
}

export interface EverpayTransaction {
  // a transaction that everpay json saved to ar
  id: string
  nonce: number
  action: EverpayActionWithDeposit
  from: string
  to: string
  amount: string
  data: string
  fee: string
  feeRecipient: string
  sig: string
  status: EverpayTransactionStatus
  timestamp: number
}

export interface BalanceParams {
  chainType: ChainType
  symbol: string
  account?: string
}

export interface DepositParams {
  chainType: ChainType
  symbol: string
  amount: number
}

export interface WithdrawParams {
  chainType: ChainType
  symbol: string
  amount: number
  to?: string
}

export interface TransferParams extends WithdrawParams {
  to: string
}

export abstract class EverpayBase {
  abstract info (): Promise<EverpayInfo>
  abstract balance (params?: BalanceParams): Promise<number>
  abstract deposit (params: DepositParams): Promise<TransactionResponse>
  abstract withdraw (params: WithdrawParams): Promise<PostEverpayTxResult>
  abstract transfer (params: TransferParams): Promise<PostEverpayTxResult>
}
