
import { prisma } from "../../config/database.config";



/**
 * Generates a unique username using first name + suffix
 * Example: raj, raj_7, raj_x9
 */
export async function generateUniqueUsername(
  firstName: string
): Promise<string> {
  const base = firstName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // sanitize

  let username = base;
  let exists = true;

  while (exists) {
    const found = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    if (!found) {
      exists = false;
    } else {
      const suffix = Math.random().toString(36).substring(2, 5); // 3 chars
      username = `${base}_${suffix}`;
    }
  }

  return username;
}
