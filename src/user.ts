import type { WireUser } from './payload';
import { generateUuid } from './uuid';

const ANONYMOUS_STORAGE_KEY = 'excalibur:anonymous-id';

export interface UserDetails {
  identifier?: string;
  isAnonymous?: boolean;
  email?: string;
  fullName?: string;
  firstName?: string;
  uuid?: string;
}

/** Stable anonymous identity, persisted in localStorage across sessions. */
export function anonymousUser(): UserDetails {
  let uuid: string | null = null;

  try {
    uuid = localStorage.getItem(ANONYMOUS_STORAGE_KEY);
    if (!uuid) {
      uuid = generateUuid();
      localStorage.setItem(ANONYMOUS_STORAGE_KEY, uuid);
    }
  } catch {
    uuid = generateUuid();
  }

  return { identifier: uuid, isAnonymous: true, uuid };
}

export function toWireUser(user: UserDetails): WireUser {
  return {
    Identifier: user.identifier,
    IsAnonymous: user.isAnonymous ?? false,
    Email: user.email,
    FullName: user.fullName,
    FirstName: user.firstName,
    UUID: user.uuid,
  };
}
