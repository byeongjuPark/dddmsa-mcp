import pg from 'pg';

export function doSomething(axios: any, eventBus: any, client: any) {
    axios.post("http://api.service.com/v1/user");
    client.GetUserInfo();
    eventBus.emit("USER_CREATED");
}
