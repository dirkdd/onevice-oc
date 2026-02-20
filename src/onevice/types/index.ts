// Shared types for OneVice intelligence layer

export type DataSensitivityLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type UserRole =
  | "SALESPERSON"
  | "ANALYST"
  | "MANAGER"
  | "LEADERSHIP";

export type AgentType = "sales" | "talent" | "bidding" | "custom";

export type UserContext = {
  user_id: string;
  role: UserRole;
  data_sensitivity: DataSensitivityLevel;
  department?: string;
};

export type UserAgentConfig = {
  id: string;
  user_id: string;
  agent_name: string;
  agent_type: AgentType;
  system_prompt?: string;
  tools_enabled: string[];
  model_preference: string;
  temperature: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AgentSession = {
  id: string;
  user_id: string;
  agent_id: string;
  conversation_id: string;
  state: Record<string, unknown>;
  created_at: string;
  last_active: string;
};

export type QueryRequest = {
  message: string;
  user_context: UserContext;
  conversation_id: string;
  agent_id?: string;
  agent_type?: AgentType;
};

export type QueryResponse = {
  content: string;
  agent_info: {
    type: string;
    primary_agent: string;
    routing_strategy: string;
    agents_used?: string[];
  };
  conversation_id: string;
  timestamp: string;
};
