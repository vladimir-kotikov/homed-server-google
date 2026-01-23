import appConfig from "./config.ts";
import { HomedServerController } from "./controller.ts";
import { UserRepository } from "./db/repositories/index.ts";
import { WebApp } from "./web/app.ts";

const { databaseUrl, tcpPort, httpPort } = appConfig;

// Database initialization
// async function initDb() {
//   // Initialize database connection
//   initializeDatabase(databaseUrl);
//   const userRepository = new UserRepository();

//   try {
//     // In test environment, always ensure test user exists
//     if (env !== "production") {
//       const username = process.env.TEST_USERNAME || "test";
//       const password = process.env.TEST_PASSWORD || "test";

//       const existingUser = await userRepository.findByUsername(username);

//       if (!existingUser) {
//         const clientToken =
//           env !== "production"
//             ? "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e"
//             : crypto.randomBytes(32).toString("hex");

//         await userRepository.createUser(
//           username,
//           await bcrypt.hash(password, 10),
//           clientToken
//         );

//         console.log(`✅ Test user created: ${username}`);
//         console.log(`   Password: ${password}`);
//         console.log(`   Client Token: ${clientToken}`);
//         console.log(`   Login at: http://localhost:${httpPort}/`);

//         // TODO: Figure out why this is needed for tests to pass
//         if (env !== "production") {
//           // Write test configuration file
//           const confPath = "tests/integration/homed-cloud.conf";
//           const confTemplate = fs.existsSync(
//             "tests/integration/homed-cloud.conf.template"
//           )
//             ? fs.readFileSync(
//                 "tests/integration/homed-cloud.conf.template",
//                 "utf8"
//               )
//             : `cloud:\n  token: ${clientToken}\n  username: ${username}`;

//           fs.writeFileSync(
//             confPath,
//             confTemplate.replace("${CLIENT_TOKEN}", clientToken)
//           );
//           console.log(`✅ Test configuration written to ${confPath}`);
//         }
//       } else {
//         console.log(`Test user already exists: ${username}`);
//       }
//     }
//   } catch (error) {
//     console.warn("Database initialization check failed:", error);
//   }
// }

// Initialize database before starting servers
const httpHandler = new WebApp();
const usersDatabase = UserRepository.open(databaseUrl, { create: true });

const controller = new HomedServerController(usersDatabase, httpHandler);

const shutdown = async () => {
  console.log("Shutting down...");
  controller.stop();
  usersDatabase.close();
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

controller.start(httpPort, tcpPort);
