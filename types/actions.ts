export interface ActionDefinition {
  readonly id: string; readonly label: string; readonly group: string; readonly target: string;
  readonly contexts: readonly string[]; readonly repeat: 'once' | 'repeat';
  readonly parameter?: Readonly<{ name: string; unit: string; default: number }>;
  readonly controlLabel?: string; readonly menuLabel?: string; readonly internal?: boolean;
}
export type ActionRow = [string, string, string, string, string[], ('once' | 'repeat')?, Partial<ActionDefinition>?];
export interface ActionCatalog {
  readonly groups: Readonly<Record<string,string>>;
  readonly all: readonly ActionDefinition[];
  readonly byId: Readonly<Record<string,ActionDefinition>>;
  get(id: string): ActionDefinition | undefined;
  list(options?: { group?: string; context?: string; includeInternal?: boolean }): readonly ActionDefinition[];
}
