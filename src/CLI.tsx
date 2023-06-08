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

import { program } from "commander";
import { render } from "ink";
import App from "./App.js";

program
  .name("eXF1LT")
  .version("0.0.0");

program
  .argument("<topics...>", "Formula1 Live Timing topics to subscribe to")
  .option("--signalr-url <url>", "URL to use for SignalR",
          "https://livetiming.formula1.com/signalr")
  .option("--streaming-hub <hub>", "Formula1 Live Timing SignalR streaming hub to connect to",
          "streaming")
  .option("--feed-method <method>", "Formula1 Live Timing SignalR streaming method to use", "feed")
  .action((topics, opts) => {
    process.on("SIGINT", () => {
      process.exit();
    });

    render(<App topics={topics} opts={opts} />);
  });

program.parse();
