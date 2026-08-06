// Cross-component navigation events dispatched by keyboard shortcuts (AppShell)
// and handled by Topbar. Kept out of Topbar.tsx because a component file may
// only export components — exporting these functions there breaks React Fast
// Refresh and forces a full app remount on every edit.
export const ENTER_SUBSYSTEM_EVENT = 'vibewire:enter-subsystem';
export const OPEN_SUBSYSTEM_PICKER_EVENT = 'vibewire:open-subsystem-picker';
export const OPEN_MANUFACTURING_PICKER_EVENT = 'vibewire:open-manufacturing-picker';

export function enterSubsystem() {
  window.dispatchEvent(new CustomEvent(ENTER_SUBSYSTEM_EVENT));
}

export function openSubsystemPicker() {
  window.dispatchEvent(new CustomEvent(OPEN_SUBSYSTEM_PICKER_EVENT));
}

export function openManufacturingPicker() {
  window.dispatchEvent(new CustomEvent(OPEN_MANUFACTURING_PICKER_EVENT));
}
