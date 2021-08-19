import { getEverpayTxMessage, signMessageAsync, transferAsync } from './lib/sign'
import { getDexInfo, getEverpayBalance, getEverpayBalances, getEverpayInfo, getEverpayTransaction, getEverpayTransactions, getExpressInfo, getMintdEverpayTransactionByChainTxHash, postTx } from './api'
import { everpayTxVersion, getExpressHost, getEverpayHost, getDexHost } from './config'
import { getTimestamp, getTokenBySymbol, toBN, getAccountChainType, fromDecimalToUnit, genTokenTag, matchTokenTag, genExpressData, fromUnitToDecimalBN } from './utils/util'
import { DexInfo, GetEverpayBalanceParams, GetEverpayBalancesParams, GetEverpayTransactionsParams } from './types/api'
import { checkParams } from './utils/check'
import { ERRORS } from './utils/errors'
import { utils } from 'ethers'
import {
  Config, EverpayInfo, EverpayBase, BalanceParams, BalancesParams, DepositParams,
  TransferOrWithdrawResult, TransferParams, WithdrawParams, EverpayTxWithoutSig, EverpayAction,
  BalanceItem, TxsParams, TxsByAccountParams, TxsResult, EverpayTransaction, Token, EthereumTransaction, ArweaveTransaction, ExpressInfo, CachedInfo
} from './types'

export * from './types'
class Everpay extends EverpayBase {
  constructor (config?: Config) {
    super()
    this._config = {
      ...config,
      account: config?.account ?? ''
    }
    this._apiHost = getEverpayHost(config?.debug)
    this._expressHost = getExpressHost(config?.debug)
    this._dexHost = getDexHost(config?.debug)
    this._cachedInfo = {}
  }

  private readonly _apiHost: string
  private readonly _expressHost: string
  private readonly _dexHost: string
  private readonly _config: Config
  private _cachedInfo: CachedInfo

  getAccountChainType = getAccountChainType

  private readonly cacheInfoHelper = async (key: 'everpay' | 'express' | 'dex'): Promise<EverpayInfo | ExpressInfo | DexInfo> => {
    const timestamp = getTimestamp()
    // cache info 3 mins
    if (this._cachedInfo[key]?.value != null &&
      (this._cachedInfo[key] as any).timestamp < timestamp - 3 * 60) {
      return this._cachedInfo[key]?.value as EverpayInfo | ExpressInfo | DexInfo
    }

    if (key === 'everpay') {
      const value = await await getEverpayInfo(this._apiHost)
      this._cachedInfo[key] = { value, timestamp }
    } else if (key === 'express') {
      const value = await await getExpressInfo(this._apiHost)
      this._cachedInfo[key] = { value, timestamp }
    } else if (key === 'dex') {
      const value = await await getDexInfo(this._apiHost)
      this._cachedInfo[key] = { value, timestamp }
    }
    return this._cachedInfo[key]?.value as EverpayInfo | ExpressInfo | DexInfo
  }

  async info (): Promise<EverpayInfo> {
    const result = await this.cacheInfoHelper('everpay')
    return result as EverpayInfo
  }

  async expressInfo (): Promise<ExpressInfo> {
    const result = await this.cacheInfoHelper('express')
    return result as ExpressInfo
  }

  async dexInfo (): Promise<DexInfo> {
    const result = await this.cacheInfoHelper('dex')
    return result as DexInfo
  }

  async balance (params: BalanceParams): Promise<string> {
    await this.info()
    const { symbol, account } = params
    const acc = account ?? this._config.account as string
    const token = getTokenBySymbol(symbol, this._cachedInfo?.everpay?.value.tokenList)
    checkParams({ account: acc, symbol, token })
    const mergedParams: GetEverpayBalanceParams = {
      tokenTag: genTokenTag(token as Token),
      account: acc
    }
    const everpayBalance = await getEverpayBalance(this._apiHost, mergedParams)
    return fromDecimalToUnit(everpayBalance.balance.amount, everpayBalance.balance.decimals)
  }

  async balances (params?: BalancesParams): Promise<BalanceItem[]> {
    await this.info()
    params = (params ?? {}) as BalanceParams
    const { account } = params
    const acc = account ?? this._config.account as string
    checkParams({ account: acc })
    const mergedParams: GetEverpayBalancesParams = {
      account: acc
    }
    const everpayBalances = await getEverpayBalances(this._apiHost, mergedParams)
    const balances = everpayBalances.balances.map(item => {
      const tag = item.tag
      const [chainType, symbol, address] = tag.split('-')
      return {
        chainType,
        symbol: symbol.toUpperCase(),
        address,
        balance: fromDecimalToUnit(item.amount, item.decimals)
      }
    })
    return balances
  }

  private async getMergedTxsParams (params: TxsParams): Promise<GetEverpayTransactionsParams> {
    const { page, symbol, action } = params
    const mergedParams: GetEverpayTransactionsParams = {}
    if (page !== undefined) {
      mergedParams.page = page
    }
    if (symbol !== undefined) {
      await this.info()
      const token = getTokenBySymbol(symbol, this._cachedInfo?.everpay?.value.tokenList) as Token
      checkParams({ token })
      mergedParams.tokenId = token.id
    }
    if (action !== undefined) {
      checkParams({ action })
      mergedParams.action = action
    }
    return mergedParams
  }

  async txs (params: TxsParams): Promise<TxsResult> {
    const mergedParams: GetEverpayTransactionsParams = await this.getMergedTxsParams(params)
    return await getEverpayTransactions(this._apiHost, mergedParams)
  }

  async txsByAccount (params: TxsByAccountParams): Promise<TxsResult> {
    checkParams({ account: params.account ?? this._config.account })
    const mergedParams: GetEverpayTransactionsParams = await this.getMergedTxsParams(params)
    mergedParams.account = params.account ?? this._config.account
    return await getEverpayTransactions(this._apiHost, mergedParams)
  }

  async txByHash (everHash: string): Promise<EverpayTransaction> {
    checkParams({ everHash })
    return await getEverpayTransaction(this._apiHost, everHash)
  }

  async mintedTxByChainTxHash (chainTxHash: string): Promise<EverpayTransaction> {
    checkParams({ chainTxHash })
    return await getMintdEverpayTransactionByChainTxHash(this._apiHost, chainTxHash)
  }

  async deposit (params: DepositParams): Promise<EthereumTransaction | ArweaveTransaction> {
    await this.info()
    const { amount, symbol } = params
    const token = getTokenBySymbol(symbol, this._cachedInfo?.everpay?.value.tokenList) as Token
    const value = utils.parseUnits(toBN(amount).toString(), token?.decimals)
    const from = this._config.account
    checkParams({ account: from, symbol, token, amount })

    return await transferAsync(this._config, this._cachedInfo.everpay?.value as EverpayInfo, {
      symbol,
      token,
      from: from ?? '',
      value
    })
  }

  async getEverpayTxWithoutSig (type: 'transfer' | 'withdraw', params: TransferParams | WithdrawParams): Promise<EverpayTxWithoutSig> {
    await this.info()
    const { symbol, amount, fee, quickMode } = params as WithdrawParams
    const token = getTokenBySymbol(symbol, this._cachedInfo?.everpay?.value.tokenList)
    checkParams({ token })

    const from = this._config.account as string
    let data = params.data
    let to = params?.to as string
    let decimalFeeBN = toBN(0)
    let decimalOperateAmountBN = toBN(0)
    let action = EverpayAction.transfer

    if (type === 'transfer') {
      action = EverpayAction.transfer
      decimalOperateAmountBN = fromUnitToDecimalBN(amount, token?.decimals ?? 0)

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    } else if (type === 'withdraw') {
      const chainType = (params as WithdrawParams).chainType
      const tokenChainType = token?.chainType as string

      // 快速提现
      if (quickMode === true) {
        action = EverpayAction.transfer
        const expressInfo = await this.expressInfo()
        const tokenTag = genTokenTag(token as Token)
        const foundExpressTokenData = expressInfo.tokens.find(t => matchTokenTag(tokenTag, t.tokenTag))
        if (foundExpressTokenData == null) {
          throw new Error(ERRORS.WITHDRAW_TOKEN_NOT_SUPPORT_QUICK_MODE)
        }

        const quickWithdrawLimitBN = fromUnitToDecimalBN(foundExpressTokenData.walletBalance, token?.decimals ?? 0)

        // 快速提现的手续费，只放入 data 字段中
        const quickWithdrawFeeBN = fee !== undefined
          ? fromUnitToDecimalBN(fee, token?.decimals ?? 0)
          : toBN(foundExpressTokenData.withdrawFee)

        // 快速提现的 amount 为全部数量
        decimalOperateAmountBN = fromUnitToDecimalBN(amount, token?.decimals ?? 0)

        if (decimalOperateAmountBN.lte(quickWithdrawFeeBN)) {
          throw new Error(ERRORS.WITHDRAW_AMOUNT_LESS_THAN_FEE)
        }

        if (decimalOperateAmountBN.gt(quickWithdrawLimitBN)) {
          throw new Error(ERRORS.INSUFFICIENT_QUICK_WITHDRAWAL_AMOUNT)
        }

        const expressData = genExpressData({
          chainType, to, fee: quickWithdrawFeeBN.toString()
        })
        data = data !== undefined ? { ...data, ...expressData } : { ...expressData }

        // to 需要更改为快速提现收款账户
        to = expressInfo.address

        // 普通提现
      } else {
        action = EverpayAction.withdraw
        decimalFeeBN = fee !== undefined ? fromUnitToDecimalBN(fee, token?.decimals ?? 0) : toBN(token?.burnFee ?? '0')
        // 普通提现只有在可跨链提现的资产时，才需要 targetChainType
        if (tokenChainType !== chainType && tokenChainType.includes(chainType)) {
          const targetChainType = chainType
          data = data !== undefined ? { ...data, targetChainType } : { targetChainType }
        }
        decimalOperateAmountBN = fromUnitToDecimalBN(amount, token?.decimals ?? 0).minus(decimalFeeBN)
        // 普通提现的 amount 为实际到账数量
        if (decimalOperateAmountBN.lte(0)) {
          throw new Error(ERRORS.WITHDRAW_AMOUNT_LESS_THAN_FEE)
        }
      }
    }

    const everpayTxWithoutSig: EverpayTxWithoutSig = {
      tokenSymbol: symbol,
      action,
      from,
      to,
      amount: decimalOperateAmountBN.toString(),
      fee: decimalFeeBN.toString(),
      feeRecipient: this._cachedInfo?.everpay?.value.feeRecipient ?? '',
      nonce: Date.now().toString(),
      tokenID: token?.id as string,
      chainType: token?.chainType as string,
      chainID: token?.chainID as string,
      data: data !== undefined ? JSON.stringify(data) : '',
      version: everpayTxVersion
    }
    return everpayTxWithoutSig
  }

  async getEverpayTxMessage (type: 'transfer' | 'withdraw', params: TransferParams | WithdrawParams): Promise<string> {
    const everpayTxWithoutSig = await this.getEverpayTxWithoutSig(type, params)
    return getEverpayTxMessage(everpayTxWithoutSig)
  }

  async sendEverpayTx (type: 'transfer' | 'withdraw', params: TransferParams | WithdrawParams): Promise<TransferOrWithdrawResult> {
    const { symbol, amount } = params
    const to = params?.to
    const token = getTokenBySymbol(symbol, this._cachedInfo?.everpay?.value.tokenList)
    const from = this._config.account as string
    const everpayTxWithoutSig = await this.getEverpayTxWithoutSig(type, params)

    checkParams({ account: from, symbol, token, amount, to })

    const messageData = getEverpayTxMessage(everpayTxWithoutSig)
    const { everHash, sig } = await signMessageAsync(this._config, messageData)
    const everpayTx = {
      ...everpayTxWithoutSig,
      sig
    }
    const postEverpayTxResult = await postTx(this._apiHost, everpayTx)
    return {
      ...postEverpayTxResult,
      everpayTx,
      everHash
    }
  }

  async transfer (params: TransferParams): Promise<TransferOrWithdrawResult> {
    await this.info()
    return await this.sendEverpayTx('transfer', params)
  }

  async withdraw (params: WithdrawParams): Promise<TransferOrWithdrawResult> {
    await this.info()
    const to = params.to ?? this._config.account as string
    return await this.sendEverpayTx('withdraw', {
      ...params,
      to
    })
  }
}

export default Everpay
