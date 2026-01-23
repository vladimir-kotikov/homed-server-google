import * as bcrypt from "bcrypt";
import * as crypto from "node:crypto";
import { type User, UserRepository } from "../db/repository.ts";

export class AuthService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = new UserRepository();
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

      return this.userRepository.createUser(
        username,
        passwordHash,
        clientToken
      );
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
  ): Promise<User | undefined> {
    try {
      const user = await this.userRepository.findByUsername(username);

      if (!user) {
        return;
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return;
      }

      return user;
    } catch (error) {
      console.error("Error validating user credentials:", error);
      return;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    return this.userRepository.getUser(userId);
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    return this.userRepository.findByUsername(username);
  }

  /**
   * Generate a random client token (32-character hex string)
   */
  private generateClientToken(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    // Drizzle with better-sqlite3 doesn't need explicit disconnect
    // but we keep the method for API compatibility
  }
}
