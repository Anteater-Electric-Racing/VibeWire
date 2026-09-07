import { useEffect, useMemo } from 'react';
import { derivePresenceFocus } from '../../lib/collaborationPresence';
import { useSystemStore } from '../../store';

export function PresenceController() {
  const appView = useSystemStore((state) => state.appView);
  const editingSurface = useSystemStore((state) => state.editingSurface);
  const openEnclosureId = useSystemStore((state) => state.openEnclosureId);
  const activeSubsystemId = useSystemStore((state) => state.activeSubsystemId);
  const selectedItem = useSystemStore((state) => state.selectedItem);
  const selectedHarnessBundle = useSystemStore((state) => state.selectedHarnessBundle);
  const selectedTextBoxId = useSystemStore((state) => state.selectedTextBoxId);
  const selectedImageId = useSystemStore((state) => state.selectedImageId);
  const connectorLibraryTargetId = useSystemStore((state) => state.connectorLibraryTargetId);
  const signalLibraryTargetId = useSystemStore((state) => state.signalLibraryTargetId);
  const manufacturingTargetBundleId = useSystemStore((state) => state.manufacturingTargetBundleId);
  const collabAvailable = useSystemStore((state) => state.collabAvailable);
  const userId = useSystemStore((state) => state.session.user?.id ?? null);
  const publishPresence = useSystemStore((state) => state.publishPresence);

  const focus = useMemo(() => derivePresenceFocus({
    appView,
    editingSurface,
    selectedItem,
    selectedHarnessBundle,
    selectedTextBoxId,
    selectedImageId,
    connectorLibraryTargetId,
    signalLibraryTargetId,
    manufacturingTargetBundleId,
    activeSubsystemId,
  }), [
    activeSubsystemId,
    appView,
    connectorLibraryTargetId,
    editingSurface,
    manufacturingTargetBundleId,
    selectedHarnessBundle,
    selectedImageId,
    selectedItem,
    selectedTextBoxId,
    signalLibraryTargetId,
  ]);

  useEffect(() => {
    if (!collabAvailable || !userId) return;
    publishPresence({
      appView,
      editingSurface,
      openEnclosureId,
      activeSubsystemId,
      focus,
    });
  }, [
    activeSubsystemId,
    appView,
    collabAvailable,
    editingSurface,
    focus,
    openEnclosureId,
    publishPresence,
    userId,
  ]);

  return null;
}
