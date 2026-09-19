// ── Desktop sidebar: destinations named, one row current, identity at the floor
// Source-text guards for the IA (this repo has no component render harness)
// plus unit tests for sidebarRowIsActive / ROLE_LABEL, which are pure.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sidebarRowIsActive, ROLE_LABEL, tabBadge, NAV, tabMenuFor } from '@/components/farm/navigation'
import type { ScreenId } from '@/components/farm/navigation'

const navigation = readFileSync(join(process.cwd(), 'components/farm/navigation.tsx'), 'utf8')
const css = readFileSync(join(process.cwd(), 'app/global.css'), 'utf8')
const dashboard = readFileSync(join(process.cwd(), 'components/farm/dashboard.tsx'), 'utf8')

describe('one vocabulary for both shells', () => {
  it('uses farmer words, not schema names', () => {
    expect(NAV.houses).toBe('Houses & fields')
    expect(NAV.stages).toBe('Stages')
    expect(NAV.byFarm).toBe('By farm & house')
    expect(NAV.money).toBe('Money')
    expect(NAV.inventory).toBe('Inventory')
    expect(NAV.advisor).toBe('AI advisor')
    expect(NAV.approvals).toBe('Approvals')
    expect(NAV.manage).toBe('Manage')
  })

  it('sidebar and the Farm sheet read the same labels', () => {
    expect(navigation).toMatch(/label: NAV.houses/)
    expect(navigation).toMatch(/label: NAV.livestock/)
    expect(navigation).toMatch(/label: NAV.crops/)
    expect(navigation).toMatch(/label: NAV.products/)
    expect(navigation).toMatch(/label: NAV.stages/)
    expect(navigation).not.toMatch(/label: 'Units & batches'/)
    expect(navigation).not.toMatch(/label: 'Production units'/)
    expect(navigation).not.toMatch(/label: 'Livestock batches'/)
    expect(navigation).not.toMatch(/label: 'Stock'/)
  })
})

describe('sidebar names each farm destination', () => {
  it('lists the four Farm tabs instead of one Units & batches row', () => {
    expect(navigation).toMatch(/params: \{ tab: 'crops' \}/)
    expect(navigation).toMatch(/params: \{ tab: 'units' \}/)
    expect(navigation).toMatch(/params: \{ tab: 'livestock' \}/)
    expect(navigation).toMatch(/params: \{ tab: 'products' \}/)
  })

  it('gives Stages a row of its own', () => {
    expect(navigation).toMatch(/id: 'farm-config' as ScreenId, label: NAV.stages/)
  })

  it('gives Notifications a row, and does not park the unread count on Home', () => {
    expect(navigation).toMatch(/id: 'notifications' as ScreenId, label: NAV.notifications/)
    expect(navigation).toMatch(/tab\.id === 'dashboard'\s*\n\s*\? null/)
  })

  it('names Approvals and By farm & house, not Governance and Dimensions', () => {
    expect(navigation).toMatch(/id: 'governance' as ScreenId, label: NAV.approvals/)
    expect(navigation).toMatch(/id: 'dimensions' as ScreenId, label: NAV.byFarm/)
  })

  it('calls the setup row Finish setup, not the same words as a group heading', () => {
    expect(navigation).toMatch(/id: 'getting-started' as ScreenId, label: NAV.finishSetup/)
    expect(navigation).not.toMatch(/label: 'Set up your farm'/)
    expect(navigation).not.toMatch(/label: 'Start here'/)
    expect(navigation).toMatch(/label: NAV.theFarm/)
    expect(navigation).toMatch(/label: NAV.today/)
    expect(navigation).toMatch(/label: NAV.money/)
  })

  it('keeps Settings in the footer, not under Money', () => {
    expect(navigation).toMatch(/sidebar-row-label">\{NAV\.settings\}</)
    expect(navigation).not.toMatch(/label: 'Business'/)
    expect(navigation).not.toMatch(/label: 'The books'/)
  })

  it('still hides the setup row once the farm is running', () => {
    expect(navigation).toMatch(/setupOnly: true/)
    expect(navigation).toMatch(/const setupIncomplete = !!setupState && !setupState\.complete/)
    expect(navigation).toMatch(/\$\{setupState\.completed\} of \$\{setupState\.total\}/)
  })
})

describe('sidebar identity and chrome', () => {
  it('makes the wordmark a home link', () => {
    expect(navigation).toMatch(/className="farm-sidebar-home"/)
    expect(navigation).toMatch(/onClick=\{\(\) => navigate\(homeScreen\)\}/)
  })

  it('reads tenant branding instead of hardcoding IFMS as the only name', () => {
    expect(navigation).toMatch(/orgName/)
    expect(navigation).toMatch(/logoEmoji/)
  })

  it('prints a human role, not the raw slug', () => {
    expect(ROLE_LABEL.super_admin).toBe('Platform admin')
    expect(ROLE_LABEL.vet).toBe('Veterinarian')
    expect(navigation).toMatch(/ROLE_LABEL\[role\]/)
    expect(navigation).not.toMatch(/textTransform: 'capitalize' \}\{role\}/)
  })

  it('labels Sign out and confirms with the centered dialog, not a phone sheet', () => {
    expect(navigation).toMatch(/<LogoutButton labeled/)
    expect(navigation).toMatch(/sidebar-row-label">Sign out</)
    expect(navigation).toMatch(/confirmLabel: 'Sign out'/)
    expect(navigation).not.toMatch(/alignItems: 'flex-end', zIndex: 500/)
  })

  it('hides the TopNav sign-out once the sidebar is showing', () => {
    expect(navigation).toMatch(/className="top-nav-signout"/)
    expect(css).toMatch(/\.top-nav-signout \{ display: none; \}/)
  })

  it('hides the dashboard farm switcher once the sidebar is showing', () => {
    expect(dashboard).toMatch(/className="farm-switcher-in-header"/)
    expect(css).toMatch(/\.farm-switcher-in-header \{ display: none !important; \}/)
  })

  it('only offers a farm filter when there is more than one farm', () => {
    expect(navigation).toMatch(/const showFarmFilter = farms\.length > 1 && !current\.startsWith\('admin-'\)/)
  })

  it('can collapse to an icon rail, and the preference survives a reload', () => {
    expect(navigation).toMatch(/ifms\.sidebar\.collapsed/)
    expect(css).toMatch(/\.farm-sidebar\.is-collapsed/)
    expect(navigation).toMatch(/aria-label=\{collapsed \? 'Expand navigation' : 'Collapse navigation'\}/)
  })

  it('sizes rows for a finger, and styles sidebar badges as pills', () => {
    expect(css).toMatch(/\.sidebar-row \{[\s\S]*min-height: 44px/)
    expect(css).toMatch(/\.sidebar-badge/)
  })

  it('exposes groups as headings and rows as a list', () => {
    expect(navigation).toMatch(/<h2 className="sidebar-group-label">/)
    expect(navigation).toMatch(/<ul className="sidebar-list">/)
  })
})

describe('sidebarRowIsActive — exactly one row is current', () => {
  const farmRows = [
    { id: 'crops' as ScreenId, params: { tab: 'units' } },
    { id: 'crops' as ScreenId, params: { tab: 'livestock' } },
    { id: 'crops' as ScreenId, params: { tab: 'crops' } },
    { id: 'crops' as ScreenId, params: { tab: 'products' } },
    { id: 'farm-config' as ScreenId },
    { id: 'dimensions' as ScreenId },
  ]
  const adminRows = [
    { id: 'admin-users' as ScreenId },
    { id: 'admin-users' as ScreenId, params: { tab: 'password-resets' } },
    { id: 'admin-users' as ScreenId, params: { tab: 'impersonation-log' } },
  ]

  it('lights Livestock for a bare #crops, not every Farm row', () => {
    const current = farmRows.map((row) => sidebarRowIsActive('crops', {}, row, farmRows))
    expect(current).toEqual([false, true, false, false, false, false])
  })

  it('lights only Houses & fields when that tab is open', () => {
    const current = farmRows.map((row) => sidebarRowIsActive('crops', { tab: 'units' }, row, farmRows))
    expect(current).toEqual([true, false, false, false, false, false])
  })

  it('does not light a Farm row when Dimensions is open', () => {
    const current = farmRows.map((row) => sidebarRowIsActive('dimensions', {}, row, farmRows))
    expect(current).toEqual([false, false, false, false, false, true])
  })

  it('does not light a Farm row when Farm configuration is open', () => {
    const current = farmRows.map((row) => sidebarRowIsActive('farm-config', {}, row, farmRows))
    expect(current).toEqual([false, false, false, false, true, false])
  })

  it('maps batch-detail to Livestock only', () => {
    const current = farmRows.map((row) => sidebarRowIsActive('batch-detail', { batchId: 'b1' }, row, farmRows))
    expect(current).toEqual([false, true, false, false, false, false])
  })

  it('lights Users alone on the default admin-users tab, not the two deep-links', () => {
    const current = adminRows.map((row) => sidebarRowIsActive('admin-users', {}, row, adminRows))
    expect(current).toEqual([true, false, false])
  })

  it('lights Password resets without also lighting Users', () => {
    const current = adminRows.map((row) => sidebarRowIsActive('admin-users', { tab: 'password-resets' }, row, adminRows))
    expect(current).toEqual([false, true, false])
  })

  it('lights Notifications, not Home, on the notifications screen', () => {
    const rows = [
      { id: 'dashboard' as ScreenId },
      { id: 'notifications' as ScreenId },
    ]
    expect(sidebarRowIsActive('notifications', {}, rows[0], rows)).toBe(false)
    expect(sidebarRowIsActive('notifications', {}, rows[1], rows)).toBe(true)
  })
})

describe('unread count belongs on Notifications in the sidebar', () => {
  it('still feeds the mobile Home tab, and also the desktop Notifications row', () => {
    expect(tabBadge('dashboard', 0, 4, 0, 0)).toBe(4)
    expect(tabBadge('notifications', 0, 4, 0, 0)).toBe(4)
  })
})

describe('android bottom bar', () => {
  it('keeps the tab bar tappable while a sheet is open', () => {
    expect(css).toMatch(/\.tab-menu-overlay \{/)
    expect(css).toMatch(/z-index: 40/)
    expect(css).toMatch(/padding-bottom: calc\(var\(--bottom-nav-height\)/)
    expect(navigation).toMatch(/setOpenMenu\(\(open\) => \(open === tab\.id \? null : tab\.id\)\)/)
  })

  it('sizes sheet rows and tab labels for a thumb in the yard', () => {
    expect(css).toMatch(/\.tab-menu-row \{[\s\S]*min-height: 52px/)
    expect(css).toMatch(/\.bottom-nav-item \.nav-label \{[\s\S]*font-size: var\(--fs-xs\)/)
  })

  it('Farm sheet is the place and the people; Manage is the office', () => {
    const farm = tabMenuFor('crops', 'owner')
    const manage = tabMenuFor('settings', 'owner')
    expect(farm?.items.map((i) => i.screen)).toEqual([
      'crops', 'crops', 'crops', 'crops', 'farm-config', 'inventory', 'people',
    ])
    expect(manage?.items[0].screen).toBe('ai-chat')
    expect(manage?.items[0].label).toBe(NAV.advisor)
    expect(manage?.items.map((i) => i.screen)).toEqual([
      'ai-chat', 'governance', 'routines', 'weather', 'dimensions', 'reports', 'settings',
    ])
  })

  it('does not put Inventory in the Farm sheet when Inventory is already a tab', () => {
    const farm = tabMenuFor('crops', 'manager')
    expect(farm?.items.some((i) => i.screen === 'inventory')).toBe(false)
    expect(farm?.items.some((i) => i.screen === 'people')).toBe(true)
  })

  it('manager tab is Inventory, not Stock', () => {
    expect(NAV.inventory).toBe('Inventory')
    expect(navigation).toMatch(/id: 'inventory' as ScreenId, label: NAV.inventory/)
  })
})
