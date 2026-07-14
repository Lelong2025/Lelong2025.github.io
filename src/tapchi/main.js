import { initMixingShell } from '../shared/shell.js'
import { initAuthModal } from '../shared/auth-modal.js'
import { mountSharedLoader } from '../shared/loader.js'
import { initTapchiUi } from './ui.js'
import { initAccountEvents } from './account.js'
import { initSearchEvents, initApp } from './search.js'
import { initChatEvents } from './chat.js'

initMixingShell({ active: 'tapchi' })
initAuthModal({ passwordResetRedirect: '/tapchi/', signUpRedirect: '/tapchi/' })
mountSharedLoader('#tapchi-splash-loader', { label: 'Dang tai du lieu', labelled: false })
initTapchiUi()
initAccountEvents()
initSearchEvents()
initChatEvents()
window.addEventListener('load', initApp)
