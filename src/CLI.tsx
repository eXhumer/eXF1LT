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
