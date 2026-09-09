/**
 * 鉴权 API —— 对接 auth-svc 的身份引导流（/auth/* 网关免鉴权）。
 *
 * 说明：当前 auth-svc 为「真实 HS256 签发」的过渡实现，`/auth/token` 仅按传入的
 * userId/name/role 直接签发短效 Access Token（真实接入 OIDC 后此处改为授权码/token 校验）。
 * 前端只负责「换取令牌 → 持久化注入」，不做本地密码校验。
 */

import { http } from './http';

export const ROLES = [
  'super_admin',
  'production_engineer',
  'simulation_engineer',
  'trainer',
  'manager',
  'viewer',
] as const;

export type Role = (typeof ROLES)[number];

export interface LoginPayload {
  userId: string;
  name: string;
  role: Role;
  /** 数据级授权范围（ABAC），可选 */
  scopedLineIds?: string[];
}

export interface LoginPrincipal {
  userId: string;
  name: string;
  roles: Role[];
  permissions: string[];
  tokenType: 'bearer';
  issuedAt: string;
  expiresAt: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  principal: LoginPrincipal;
}

/** 换取 Access Token（登录） */
export function login(payload: LoginPayload): Promise<TokenResponse> {
  return http.post<TokenResponse>('/auth/token', payload);
}

/** 拉取可用角色列表（供登录页角色下拉） */
export function listRoles(): Promise<string[]> {
  return http.get<string[]>('/auth/roles');
}
