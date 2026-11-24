import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { getHome } from '../repositories/home.repository.ts'

/** No count when GAS could not give one: the home page still draws without it. */
export interface HomeData {
  grantTypeCount: number | null
}

export const getHomeUseCase = async (): Promise<HomeData> => {
  try {
    const { grantTypeCount } = await getHome()

    return { grantTypeCount }
  } catch (error) {
    logger.error(
      `Could not read the grant type count from fg-gas-backend: ${describeError(error)}`
    )

    return { grantTypeCount: null }
  }
}
