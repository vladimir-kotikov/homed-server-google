import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { User } from "../types";

const prisma = new PrismaClient();

/**
 * Authentication service for user management and token validation
 */
export class AuthService {
  /**
   * Validate a client token and return the associated user
   */
  async validateClientToken(token: string): Promise<User | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { clientToken: token },
      });

      return user;
    } catch (error) {
      console.error("Error validating client token:", error);
      return null;
    }
  }

  /**
   * Create a new user with hashed password and client token
   */
  async createUser(username: string, password: string): Promise<User> {
    try {
      // Hash password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Generate random client token (hex string)
      const clientToken = this.generateClientToken();

      const user = await prisma.user.create({
        data: {
          username,
          passwordHash,
          clientToken,
        },
      });

      return user;
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error("Failed to create user");
    }
  }

  /**
   * Validate user credentials (username/password)
   */
  async validateUserCredentials(
    username: string,
    password: string
  ): Promise<User | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { username },
      });

      if (!user) {
        return null;
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return null;
      }

      return user;
    } catch (error) {
      console.error("Error validating user credentials:", error);
      return null;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      return user;
    } catch (error) {
      console.error("Error getting user by ID:", error);
      return null;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { username },
      });

      return user;
    } catch (error) {
      console.error("Error getting user by username:", error);
      return null;
    }
  }

  /**
   * Generate a random client token (32-character hex string)
   */
  private generateClientToken(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Close Prisma connection
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}
