// eXF1LT - Live Timing client for Formula 1
// Copyright (C) 2023  eXhumer

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, version 3 of the License.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { EventEmitter } from "node:events";
import { Client as SignalRClient, HubEvent } from "node-signalr";
import { TypedEventEmitter as TypedEmitter } from "typed-emitter";
import { deepMerge } from "./Utils.js";

type LiveTimingEvents = {
  connected: () => void;
  feed: (topic: string, data: any, timestamp: string) => void;
  subscribed: () => void;
};

export class F1LiveTimingClient extends (EventEmitter as new () => TypedEmitter<LiveTimingEvents>) {
  public readonly current: Record<string, any>;
  private readonly lt_client: SignalRClient;
  private readonly stream_hub: string;
  private readonly subscribed_topics: string[];
  private readonly topics: string[];

  constructor(urL: string, stream_hub: string, topics: string[]) {
    super();
    this.current = {};
    this.stream_hub = stream_hub;
    this.subscribed_topics = [];
    this.lt_client = new SignalRClient(urL, [this.stream_hub]);
    this.topics = topics;

    this.lt_client.on("connected", async () => {
      this.emit("connected");

      this.lt_client
      .connection
      .hub
      .on(this.stream_hub, "feed",
          ((topic: string, data: any, timestamp: string) => {
            this.current[topic] = (topic === "Position.z" || topic === "CarData.z") ?
              data :
              deepMerge(this.current[topic], data);

            this.emit("feed", topic, data, timestamp);
          }) as HubEvent);

      const current = await this.Subscribe();

      for (const key in current)
        this.current[key] = current[key];

      this.emit("subscribed");
    });
  }

  public end = () => {
    this.Unsubscribe().finally(() => { this.lt_client.end(); })
  }

  public start = () => {
    this.lt_client.start();
  };

  private Subscribe = async () => {
    const current = await this.lt_client
      .connection
      .hub
      .call(this.stream_hub, "Subscribe", this.topics) as Record<string, any>;

    for (const key in current)
      this.subscribed_topics.push(key);

    return current;
  }

  private Unsubscribe = async () => {
    const data = await this.lt_client
      .connection
      .hub
      .call(this.stream_hub, "Unsubscribe", this.subscribed_topics);
    this.subscribed_topics.filter(() => false);
    return data;
  }
};
