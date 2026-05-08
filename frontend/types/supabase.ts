export type MessageStatus = 'pending' | 'submitted' | 'challenge_window' | 'executed' | 'challenged' | 'reverted';
export type SubmissionStatus = 'pending' | 'confirmed' | 'challenged' | 'slashed';
export type DisputeOutcome = 'pending' | 'upheld' | 'rejected';
export type BondThresholdStatus = 'operating' | 'below_operating' | 'deregistered';
export type BridgeDirection = 'sepolia_to_neutron' | 'neutron_to_sepolia';

export interface Database {
  public: {
    Tables: {
      messages: {
        Row: {
          id: number;
          nonce: number;
          source_chain_id: string;
          source_app: string;
          destination_chain_id: string;
          destination_app: string;
          action: string;
          payload: string;
          sender: string;
          recipient: string;
          amount: string;
          source_tx_hash: string;
          source_block: number;
          status: MessageStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
      };
      submissions: {
        Row: {
          id: number;
          message_id: number;
          submitter_address: string;
          fingerprint: string;
          dest_tx_hash: string | null;
          status: SubmissionStatus;
          submitted_at: string;
          confirmed_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['submissions']['Row'], 'id' | 'submitted_at'>;
        Update: Partial<Database['public']['Tables']['submissions']['Insert']>;
      };
      disputes: {
        Row: {
          id: number;
          submission_id: number;
          challenger_address: string;
          correct_fingerprint: string;
          dispute_tx_hash: string | null;
          outcome: DisputeOutcome | null;
          filed_at: string;
          resolved_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['disputes']['Row'], 'id' | 'filed_at'>;
        Update: Partial<Database['public']['Tables']['disputes']['Insert']>;
      };
      bonds: {
        Row: {
          id: number;
          relayer_address: string;
          chain_id: string;
          balance: string;
          threshold_status: BondThresholdStatus;
          last_synced_block: number;
          synced_at: string;
        };
        Insert: Omit<Database['public']['Tables']['bonds']['Row'], 'id' | 'synced_at'>;
        Update: Partial<Database['public']['Tables']['bonds']['Insert']>;
      };
      events: {
        Row: {
          id: number;
          chain_id: string;
          block_number: number;
          tx_hash: string;
          event_type: string;
          contract_address: string;
          raw_data: Record<string, unknown>;
          indexed_at: string;
        };
        Insert: Omit<Database['public']['Tables']['events']['Row'], 'id' | 'indexed_at'>;
        Update: Partial<Database['public']['Tables']['events']['Insert']>;
      };
      benchmark_runs: {
        Row: {
          id: number;
          message_id: number | null;
          direction: BridgeDirection;
          source_block: number;
          submission_block: number | null;
          execution_block: number | null;
          total_latency_ms: number | null;
          source_gas_used: number | null;
          dest_gas_used: number | null;
          proof_transform_ms: number | null;
          run_at: string;
        };
        Insert: Omit<Database['public']['Tables']['benchmark_runs']['Row'], 'id' | 'run_at'>;
        Update: Partial<Database['public']['Tables']['benchmark_runs']['Insert']>;
      };
    };
  };
}
