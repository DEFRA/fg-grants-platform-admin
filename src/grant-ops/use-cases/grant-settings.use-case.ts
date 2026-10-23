/** GAS owns grant settings and enforces administration access on each call. */
export {
  getGrantSettings as getGrantSettingsUseCase,
  saveGrantSettings as saveGrantSettingsUseCase
} from '../repositories/grant-settings.repository.ts'
