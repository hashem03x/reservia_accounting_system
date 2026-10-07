module.exports = (
    message = "Request success",
    success  = true, 
    data, 
    pagination) =>{
    const res = {success, message};

    if(data) res.data = data;
    if(pagination) res.pagination = pagination;

    return res;
}