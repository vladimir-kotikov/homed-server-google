import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import type { User } from "../../types.ts";
import { getDrizzle } from "../index.ts";
import { users } from "../schema.ts";

export class UserRepository {
  /**
   * Find user by client token with timing-safe comparison
   */
  async findByClientToken(token: string): Promise<User | null> {
    try {
      const user = await getDrizzle().query.users.findFirst({
        where: eq(users.clientToken, token),
      });

      if (!user) {
        return null;
      }

      // Use constant-time comparison to prevent timing attacks
      const tokenBuffer = Buffer.from(token);
      const storedBuffer = Buffer.from(user.clientToken);

      if (tokenBuffer.length !== storedBuffer.length) {
        return null;
      }

      if (!crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
        return null;
      }

      return user;
    } catch (error) {
      console.error("Error finding user by client token:", error);
      return null;
    }
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    try {
      const user = await getDrizzle().query.users.findFirst({
        where: eq(users.username, username),
      });
      return user ?? null;
    } catch (error) {
      console.error("Error finding user by username:", error);
      return null;
    }
  }

  /**
   * Find user by ID
   */
  async findById(userId: string): Promise<User | null> {
    try {
      const user = await getDrizzle().query.users.findFirst({
        where: eq(users.id, userId),
      });
      return user ?? null;
    } catch (error) {
      console.error("Error finding user by ID:", error);
      return null;
    }
  }

  /**
   * Create a new user
   */
  async create(
    username: string,
    passwordHash: string,
    clientToken: string
  ): Promise<User> {
    try {
      const result = await getDrizzle()
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username,
          passwordHash,
          clientToken,
        })
        .returning();

      return result[0];
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error("Failed to create user");
    }
  }

  /**
   * Check if any users exist
   */
  async exists(): Promise<boolean> {
    try {
      const result = await getDrizzle().select().from(users);
      return result.length > 0;
    } catch (error) {
      console.error("Error checking if users exist:", error);
      return false;
    }
  }
}
