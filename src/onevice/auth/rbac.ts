// RBAC types and role-permission mapping for OneVice
// Port of backend/auth/models.py

import type { DataSensitivityLevel, UserRole } from "../types/index.js";

export const DATA_SENSITIVITY_LABELS: Record<DataSensitivityLevel, string> = {
  1: "PUBLIC",
  2: "INTERNAL",
  3: "CONFIDENTIAL",
  4: "RESTRICTED",
  5: "HIGHLY_CONFIDENTIAL",
  6: "TOP_SECRET",
};

// Maximum data sensitivity each role can access
export const ROLE_MAX_SENSITIVITY: Record<UserRole, DataSensitivityLevel> = {
  SALESPERSON: 2,
  ANALYST: 3,
  MANAGER: 4,
  LEADERSHIP: 6,
};

export function canAccessData(
  userRole: UserRole,
  requiredLevel: DataSensitivityLevel,
): boolean {
  return ROLE_MAX_SENSITIVITY[userRole] >= requiredLevel;
}

export function getMaxSensitivity(role: UserRole): DataSensitivityLevel {
  return ROLE_MAX_SENSITIVITY[role];
}
