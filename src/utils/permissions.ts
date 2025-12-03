import './env';

let cachedAdminIds: string[] | null = null;

const parseAdminIds = () => {
  const raw = process.env.BOT_ADMIN_IDS ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
};

const getAdminIds = () => {
  if (!cachedAdminIds) {
    cachedAdminIds = parseAdminIds();
  }
  return cachedAdminIds;
};

export const reloadAdminCache = () => {
  cachedAdminIds = null;
};

export const isRootAdmin = (userId: string) => getAdminIds().includes(userId);

export const canManageAuction = (userId: string, sellerId: string) =>
  isRootAdmin(userId) || userId === sellerId;
