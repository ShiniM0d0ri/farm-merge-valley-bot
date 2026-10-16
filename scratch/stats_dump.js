import { httpRpc } from "../lib/nakama.js";
import { decodeModels, b64ToBuf } from "../lib/proto.js";
const models = decodeModels(b64ToBuf(await httpRpc("GET_ALL_PLAYER_DATA_V2")));
const s = models.UserStatsModel?.json;
console.log("version=" + s?.version);
console.log(JSON.stringify(s?.data, null, 1));
