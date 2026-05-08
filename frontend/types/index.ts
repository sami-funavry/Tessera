export * from './supabase';

export interface RelayerInfo {
  id: 'A' | 'B';
  name: string;
  sepoliaAddress: string;
  neutronAddress: string;
  activity: string;
  activityType: 'busy' | 'idle' | 'benched' | 'deregistered' | 'cooling';
  bond: {
    sepolia: { gas: number; bond: number };
    neutron: { gas: number; bond: number };
  };
  earned: number;
  slashed: number;
  submissions: number;
  successRate: number;
}

export interface BridgeFormValues {
  amount: string;
  fromChain: 'sepolia' | 'neutron';
  toChain: 'sepolia' | 'neutron';
  recipient: string;
}

export interface SystemStats {
  transfers: number;
  activeRelayers: number;
  challengesThisWeek: number;
  successfulFrauds: number;
  lastSync: string;
}

export interface ScenarioType {
  id: 'honest' | 'lying' | 'silent' | 'spam';
  name: string;
  desc: string;
  color: 'emerald' | 'red' | 'amber' | 'orange';
}

export interface TxStage {
  id: string;
  label: string;
  detail: string;
  txHash?: string;
  explorer?: 'sepolia' | 'neutron';
  data?: {
    type?: string;
    root?: string;
    size?: number;
    hash?: string;
    from?: string;
    to?: string;
    transformedRoot?: string;
    duration?: string;
    remaining?: string;
    status?: string;
    challenges?: number;
  };
}

export interface EventLogEntry {
  t: string;
  tag: string;
  actor: string;
  msg: string;
}

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';
export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}
