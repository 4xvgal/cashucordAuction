import './env';

type AdminCache = {
  ids: Set<string>;
  usernames: Set<string>;
};

let cachedAdmins: AdminCache | null = null;

const normalizeEntry = (entry: string): { id?: string; username?: string } => {
  const trimmed = entry.trim();
  if (!trimmed) return {};

  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return { id: mentionMatch[1] };
  }

  if (/^\d+$/.test(trimmed)) {
    return { id: trimmed };
  }

  if (trimmed.startsWith('@')) {
    return { username: trimmed.slice(1).toLowerCase() };
  }

  return { username: trimmed.toLowerCase() };
};

const parseAdminEntries = (): AdminCache => {
  const raw = process.env.BOT_ADMIN_IDS ?? '';
  const ids = new Set<string>();
  const usernames = new Set<string>();

  for (const entry of raw.split(',')) {
    const { id, username } = normalizeEntry(entry);
    if (id) {
      ids.add(id);
    } else if (username) {
      usernames.add(username);
    }
  }

  return { ids, usernames };
};

const getAdmins = () => {
  if (!cachedAdmins) {
    cachedAdmins = parseAdminEntries();
  }
  return cachedAdmins;
};

export const reloadAdminCache = () => {
  cachedAdmins = null;
};

type UserLike = { id: string; username?: string | null; globalName?: string | null } | string;

const extractUserInfo = (user: UserLike) => {
  if (typeof user === 'string') {
    return { id: user, username: undefined, globalName: undefined };
  }
  return { id: user.id, username: user.username ?? undefined, globalName: user.globalName ?? undefined };
};

export const isRootAdmin = (user: UserLike) => {
  const { id, username, globalName } = extractUserInfo(user);
  const admins = getAdmins();

  if (admins.ids.has(id)) {
    return true;
  }

  const normalizedUsername = username?.toLowerCase();
  if (normalizedUsername && admins.usernames.has(normalizedUsername)) {
    return true;
  }

  const normalizedGlobal = globalName?.toLowerCase();
  if (normalizedGlobal && admins.usernames.has(normalizedGlobal)) {
    return true;
  }

  return false;
};

export const canManageAuction = (user: UserLike, sellerId: string) => {
  const { id } = extractUserInfo(user);
  return isRootAdmin(user) || id === sellerId;
};
