import { ClientSdk, LoginPasswordAuthMethod } from "@quadcode-tech/client-sdk-js";
import type { IqOptionEnv } from "@/config/env";
import { IQ_OPTION_API_URL, IQ_OPTION_PLATFORM_ID, IQ_OPTION_WS_URL } from "@/config/constants";

/**
 * Logs in with username and password. The SDK marks this method deprecated in favour of OAuth;
 * it still works and keeps a script simple. Call `sdk.shutdown()` when done.
 */
export function connectIqOption(env: IqOptionEnv): Promise<ClientSdk> {
  return ClientSdk.create(
    IQ_OPTION_WS_URL,
    IQ_OPTION_PLATFORM_ID,
    new LoginPasswordAuthMethod(IQ_OPTION_API_URL, env.IQ_OPTION_USER, env.IQ_OPTION_PASSWORD),
  );
}
