export function isTerminal(status: string): boolean;
export type BrowserSessionState = {phase: string; label: string; tone: string; terminal: boolean; active: boolean; live: boolean; canStop: boolean; canTakeControl: boolean; canGiveBack: boolean};
export function sessionState(session: {status: string; control: 'agent' | 'human'; executionSource?: string}): BrowserSessionState;
export function currentStep(session: unknown): string;
export function tabLabels(tabs: {id: string; title: string; url: string}[] | null | undefined): {id: string; url: string; domain: string; label: string}[];
