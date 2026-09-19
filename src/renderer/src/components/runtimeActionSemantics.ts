import type { ThemeId } from '@/scene/office/themeRegistry';

export interface RuntimeActionAvailability {
  readonly available: false;
  readonly reason: string;
}

/**
 * Legacy Munder surfaces do not own an authoritative AgentHub runtime identity.
 * Keep their runtime actions fail-closed until a business-identity action exists.
 */
export const LEGACY_RUNTIME_ACTION_POLICY = Object.freeze({
  terminateAgent: Object.freeze({
    available: false,
    reason: 'Unavailable here. Use AgentHub Agent Management for authoritative lifecycle changes.'
  }),
  restartAgent: Object.freeze({
    available: false,
    reason: 'Unavailable in AgentHub mode because no authoritative restart action is available.'
  }),
  switchRuntime: Object.freeze({
    available: false,
    reason: 'Unavailable here. Provider and model changes require AgentHub Agent Management.'
  })
}) satisfies Readonly<Record<string, RuntimeActionAvailability>>;

export interface PresentationThemeDependencies {
  readonly updateConfig: (patch: { readonly officeTheme: ThemeId }) => Promise<unknown>;
  readonly setOfficeTheme: (theme: ThemeId) => void;
}

/** Apply a visual theme without reading or mutating the Agent roster or runtime. */
export async function applyPresentationOnlyOfficeTheme(
  theme: ThemeId,
  dependencies: PresentationThemeDependencies
): Promise<void> {
  await dependencies.updateConfig({ officeTheme: theme });
  dependencies.setOfficeTheme(theme);
}
