import { useEffect, useState } from "react";
import { Box } from "ink";
import { F1LiveTimingClient } from "./Client.js";
import Logo from "./Components/Logo.js";
import WeatherData from "./Components/WeatherData.js";

type AppProps = {
  topics: string[];
  opts: {
    signalrUrl: string;
    streamingHub: string;
    feedMethod: string;
  };
};

const App = ({ topics, opts }: AppProps) => {
  const [current, setCurrent] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const lt_client = new F1LiveTimingClient(opts.signalrUrl, opts.streamingHub, topics);
    lt_client.on("subscribed", () => { setCurrent(lt_client.current); });
    lt_client.on("feed", (topic, data, timestamp) => { setCurrent(lt_client.current); });
    lt_client.start();

    return () => {
      lt_client.end();
    };
  }, []);

  return (
    <Box flexDirection="column" justifyContent="flex-start" alignItems="center">
      <Logo />
      {current !== null && "WeatherData" in current ?
        <WeatherData
          AirTemp={current["WeatherData"]["AirTemp"] as string}
          Humidity={current["WeatherData"]["Humidity"] as string}
          Pressure={current["WeatherData"]["Pressure"] as string}
          Rainfall={current["WeatherData"]["Rainfall"] as string}
          TrackTemp={current["WeatherData"]["TrackTemp"] as string}
          WindDirection={current["WeatherData"]["WindDirection"] as string}
          WindSpeed={current["WeatherData"]["WindSpeed"] as string}
        /> :
        null}
    </Box>
  );
};

export default App;