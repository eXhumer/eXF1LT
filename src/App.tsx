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

import { useEffect, useState } from "react";
import { Box } from "ink";
import { F1LiveTimingClient } from "./Client.js";
import Logo from "./Components/Logo.js";
import SessionInfo from "./Components/SessionInfo.js";
import TrackStatus from "./Components/TrackStatus.js";
import WeatherData from "./Components/WeatherData.js";
import { SessionInfo as SessionInfoType, TrackStatus as TrackStatusType,
         WeatherData as WeatherDataType } from "./Types.js";

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
    <Box
      flexDirection="column"
      justifyContent="flex-start"
      alignItems="center"
    >
      <Logo />
      <Box
        flexDirection="row"
        flexWrap="wrap"
        justifyContent="space-around"
        alignItems="stretch"
      >
        {current !== null && "WeatherData" in current ?
          <WeatherData
            current={current["WeatherData"] as WeatherDataType}
          /> :
          null}
        {current !== null && "SessionInfo" in current ?
          <SessionInfo
            current={current["SessionInfo"] as SessionInfoType}
          /> :
          null}
        {current !== null && "TrackStatus" in current ?
          <TrackStatus
            current={current["TrackStatus"] as TrackStatusType}
          /> :
          null}
      </Box>

    </Box>
  );
};

export default App;
